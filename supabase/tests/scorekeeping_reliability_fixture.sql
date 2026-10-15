\set ON_ERROR_STOP on

do $$
begin
  if current_database() !~ '^blh_reliability_test' then
    raise exception 'Refusing destructive fixture reset outside a blh_reliability_test* database';
  end if;
end
$$;

drop schema if exists public cascade;
create schema public;

create type public.user_role as enum ('owner','captain','player');
create type public.game_status as enum ('scheduled','in_progress','completed','cancelled','postponed','pending_verification');
create type public.roster_status as enum ('active','inactive','suspended','injured','traded');

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key,
  is_platform_admin boolean not null default false
);

create table public.organizations (
  id uuid primary key,
  owner_user_id uuid references public.profiles(id)
);

create table public.leagues (
  id uuid primary key,
  created_by uuid references public.profiles(id),
  organization_id uuid references public.organizations(id)
);

create table public.league_memberships (
  league_id uuid not null references public.leagues(id),
  user_id uuid not null references public.profiles(id),
  role public.user_role not null,
  status text not null,
  primary key (league_id, user_id)
);

create table public.seasons (
  id uuid primary key,
  league_id uuid not null references public.leagues(id)
);

create table public.teams (
  id uuid primary key,
  league_id uuid not null references public.leagues(id)
);

create table public.games (
  id uuid primary key,
  league_id uuid not null references public.leagues(id),
  season_id uuid not null references public.seasons(id),
  home_team_id uuid not null references public.teams(id),
  away_team_id uuid not null references public.teams(id),
  status public.game_status default 'in_progress',
  scheduled_at timestamptz not null default now(),
  home_score integer not null default 0,
  away_score integer not null default 0,
  home_verified_at timestamptz,
  away_verified_at timestamptz,
  home_captain_verified boolean not null default false,
  away_captain_verified boolean not null default false,
  home_verification_token text,
  away_verification_token text,
  home_verification_token_expires_at timestamptz,
  away_verification_token_expires_at timestamptz,
  stats_locked_at timestamptz,
  stats_submitted_at timestamptz,
  current_period integer default 0,
  period_length_minutes integer default 20,
  game_started_at timestamptz,
  playoff_series_id uuid,
  updated_at timestamptz not null default now()
);

create table public.game_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  league_id uuid not null references public.leagues(id),
  team_id uuid not null references public.teams(id),
  team_type text not null check (team_type in ('home', 'away')),
  player_id uuid references public.profiles(id),
  assist1_player_id uuid references public.profiles(id),
  assist2_player_id uuid references public.profiles(id),
  goalie_in_net_id uuid references public.profiles(id),
  event_type text not null,
  period integer,
  game_time_seconds integer,
  penalty_minutes integer,
  is_power_play boolean default false,
  is_short_handed boolean default false,
  is_empty_net boolean default false,
  is_gwg boolean default false,
  entered_by uuid not null references public.profiles(id),
  entered_at timestamptz not null default now(),
  event_version integer not null default 1,
  client_event_id text not null default gen_random_uuid()::text,
  sync_status text not null default 'synced',
  created_offline boolean not null default false,
  updated_at timestamptz default now(),
  penalty_type text,
  deleted_by uuid references public.profiles(id),
  deleted_at timestamptz
);

create table public.game_checkins (
  game_id uuid not null references public.games(id),
  player_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  status text not null
);

create table public.scorekeeper_sessions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  league_id uuid not null references public.leagues(id),
  session_type text not null default 'single',
  is_active boolean not null default true,
  expires_at timestamptz not null
  ,created_by uuid not null references public.profiles(id)
  ,session_origin text not null default 'assigned_scorekeeper'
  ,initiating_team_id uuid references public.teams(id)
  ,initiating_team_type text
  ,initiating_captain_id uuid references public.profiles(id)
);

create table public.team_rosters (
  team_id uuid not null references public.teams(id), player_id uuid not null references public.profiles(id),
  season_id uuid not null references public.seasons(id), league_id uuid not null references public.leagues(id),
  status public.roster_status not null default 'active', joined_at timestamptz default now(), end_date date,
  primary key(team_id,player_id,season_id)
);

create table public.scorekeeper_session_games (
  session_id uuid not null references public.scorekeeper_sessions(id),
  game_id uuid not null references public.games(id),
  primary key (session_id, game_id)
);

create table public.sub_invitations (
  game_id uuid not null references public.games(id),
  invited_player_id uuid references public.profiles(id),
  team_id uuid not null references public.teams(id),
  status text not null
);

create table public.player_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  season_id uuid not null references public.seasons(id),
  league_id uuid not null references public.leagues(id),
  goals integer default 0,
  assists integer default 0,
  penalty_minutes integer,
  power_play_goals integer default 0,
  power_play_assists integer default 0,
  short_handed_goals integer default 0,
  short_handed_assists integer default 0,
  empty_net_goals integer default 0,
  shots integer default 0,
  plus_minus integer default 0,
  period_1_goals integer default 0,
  period_1_assists integer default 0,
  period_2_goals integer default 0,
  period_2_assists integer default 0,
  period_3_goals integer default 0,
  period_3_assists integer default 0,
  ot_goals integer default 0,
  ot_assists integer default 0,
  game_winning_goals integer default 0,
  created_at timestamptz default now(),
  unique (game_id, player_id)
);

create table public.goalie_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  team_id uuid not null references public.teams(id),
  season_id uuid not null references public.seasons(id),
  league_id uuid not null references public.leagues(id),
  goals_against integer default 0,
  saves integer default 0,
  shots_against integer default 0,
  shutout boolean default false,
  period_1_saves integer default 0,
  period_1_shots integer default 0,
  period_2_saves integer default 0,
  period_2_shots integer default 0,
  period_3_saves integer default 0,
  period_3_shots integer default 0,
  ot_saves integer default 0,
  ot_shots integer default 0,
  game_result text,
  unique (game_id, player_id)
);

create table public.game_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id),
  league_id uuid not null references public.leagues(id),
  stat_type text not null,
  value integer not null default 0,
  team_id uuid not null references public.teams(id),
  entered_by uuid not null references public.profiles(id),
  period text not null default '1',
  team_type text not null default 'home',
  locked boolean default false
);

create table public.game_submissions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  league_id uuid not null references public.leagues(id),
  status text not null default 'draft' check(status in ('draft','pending_signatures','submitted','verified','disputed')),
  submitted_at timestamptz,
  verified_at timestamptz,
  final_home_score integer,
  final_away_score integer,
  total_goals integer,
  total_assists integer,
  total_penalties integer,
  total_saves integer,
  updated_at timestamptz default now()
  ,unique(game_id)
);

create table public.game_audit_log (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  league_id uuid not null references public.leagues(id),
  action text not null,
  changed_by uuid not null references public.profiles(id),
  previous_data jsonb,
  new_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create materialized view public.standings_calculated as
select g.season_id,g.league_id,g.home_team_id as team_id,count(*)::int games_played,sum(g.home_score)::int goals_for
from public.games g where g.status='completed' group by g.season_id,g.league_id,g.home_team_id;
create view public.team_standings as select * from public.standings_calculated;
create or replace function public.refresh_standings() returns void language plpgsql security definer set search_path=public as $$
begin
  refresh materialized view concurrently standings_calculated;
exception when others then
  refresh materialized view standings_calculated;
end $$;

create or replace function public.check_and_lock_stats() returns trigger language plpgsql as $$
begin if new.status='completed' and old.status is distinct from 'completed' and new.home_verified_at is not null and new.away_verified_at is not null then new.stats_locked_at=coalesce(new.stats_locked_at,now()); update public.game_stats set locked=true where game_id=new.id; end if; return new; end $$;
create trigger auto_lock_stats_on_verification before update on public.games for each row execute function public.check_and_lock_stats();
create or replace function public.trigger_rollup_season_stats_on_game_complete() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger trigger_season_stats_on_game_complete after update on public.games for each row when (new.status='completed' and old.status is distinct from 'completed') execute function public.trigger_rollup_season_stats_on_game_complete();
create or replace function public.trigger_refresh_standings_on_game_complete() returns trigger language plpgsql as $$ begin if new.status='completed' and old.status is distinct from 'completed' then perform public.refresh_standings(); end if; return new; end $$;
create trigger trigger_refresh_standings after update on public.games for each row execute function public.trigger_refresh_standings_on_game_complete();

create table public.playoff_effects(game_id uuid primary key, completions integer not null default 0);
create or replace function public.auto_update_playoff_series_on_game_complete() returns trigger language plpgsql as $$
begin if new.status='completed' and old.status is distinct from 'completed' then insert into public.playoff_effects(game_id,completions) values(new.id,1) on conflict(game_id) do update set completions=playoff_effects.completions+1; end if; return new; end $$;
create trigger trg_playoff_series_update after update of status on public.games for each row execute function public.auto_update_playoff_series_on_game_complete();

-- Reproduces the two catalog-confirmed failures in the deployed preferred path:
-- no matching unique constraint and an invalid all-zero entered_by profile FK.
create or replace function public.rollup_game_stats(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update games set status = 'completed' where id = p_game_id;
  insert into game_stats (game_id, player_id, league_id, stat_type, value, team_id, entered_by)
  select ge.game_id, ge.player_id, ge.league_id, 'Goal', count(*), ge.team_id,
         '00000000-0000-0000-0000-000000000000'::uuid
  from game_events ge
  where ge.game_id = p_game_id and ge.event_type = 'goal' and ge.deleted_at is null
    and ge.player_id is not null
  group by ge.game_id, ge.player_id, ge.league_id, ge.team_id
  on conflict (game_id, player_id, stat_type) do update set value = excluded.value;
end
$$;

-- Install the captured production legacy gateway bodies before the migration.
-- Their unsafe historical ACLs are intentional fixture state: the migration
-- must close each direct and indirect SECURITY DEFINER route.
\ir ../../../../artifacts/blh-stats-reliability-20260912/db-before/rollup_game_stats.sql
\ir ../../../../artifacts/blh-stats-reliability-20260912/db-before/recalculate_game_stats_from_events.sql
\ir ../../../../artifacts/blh-stats-reliability-20260912/db-before/recalculate_all_season_stats.sql
grant execute on function public.rollup_game_stats(uuid) to public, anon, authenticated, service_role;
grant execute on function public.recalculate_game_stats_from_events(uuid) to public, anon, authenticated, service_role;
grant execute on function public.recalculate_all_season_stats(uuid) to public, anon, authenticated, service_role;

insert into profiles(id) values
  ('10000000-0000-4000-8000-000000000001'), -- admin
  ('10000000-0000-4000-8000-000000000011'), -- scorer
  ('10000000-0000-4000-8000-000000000012'), -- assist only
  ('10000000-0000-4000-8000-000000000013'), -- confirmed zero-stat
  ('10000000-0000-4000-8000-000000000014'), -- measured goalie
  ('10000000-0000-4000-8000-000000000015'); -- partial-capture goalie

insert into organizations(id, owner_user_id)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
insert into leagues(id, created_by, organization_id)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
insert into league_memberships values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'active');
insert into seasons values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
insert into teams values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001');
insert into team_rosters(team_id,player_id,season_id,league_id,status,joined_at) values
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000014','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active',now()-interval '1 day'),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000015','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active',now()-interval '1 day');
insert into games(id, league_id, season_id, home_team_id, away_team_id, status,
                  home_score, away_score, home_verified_at, away_verified_at, stats_submitted_at)
values ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000002', 'pending_verification', 9, 9, now(), now(), now());

insert into game_events(id, game_id, league_id, team_id, team_type, player_id,
                        assist1_player_id, event_type, period, penalty_minutes, entered_by, deleted_at)
values
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   'home', '10000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000012', 'goal', 1, null, '10000000-0000-4000-8000-000000000001', null),
  ('70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   'home', null, null, 'goal', 2, null, '10000000-0000-4000-8000-000000000001', null),
  ('70000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002',
   'away', '10000000-0000-4000-8000-000000000011', null, 'goal', 3, null, '10000000-0000-4000-8000-000000000001', now()),
  ('70000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   'home', '10000000-0000-4000-8000-000000000011', null, 'penalty', 2, null, '10000000-0000-4000-8000-000000000001', null);

insert into game_checkins values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000013',
   '50000000-0000-4000-8000-000000000002', 'confirmed');

insert into player_stats(game_id, player_id, team_id, season_id, league_id, goals, assists, penalty_minutes, plus_minus, game_winning_goals)
values ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011',
        '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', 99, 99, 99, 7, 8),
       ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000013',
        '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', 5, 6, 7, 8, 9);

insert into goalie_stats(game_id, player_id, team_id, season_id, league_id, goals_against, saves, shots_against)
values ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000014',
        '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', 4, 40, 44);

insert into game_submissions(game_id, league_id, status, submitted_at)
values ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'submitted', now());
