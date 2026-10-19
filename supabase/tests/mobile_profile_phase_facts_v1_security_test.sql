-- Standalone destructive acceptance fixture. Run only in a fresh ephemeral database.
\set ON_ERROR_STOP on
\pset pager off

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role hostile_function_owner nologin;
create role hostile_extra_grantee nologin;
create role trusted_migration_role nologin;

grant usage on schema public to anon, authenticated, service_role, hostile_function_owner;
grant create on schema public to hostile_function_owner;
revoke create on schema public from public, service_role;
alter schema public owner to trusted_migration_role;
grant service_role, hostile_function_owner to trusted_migration_role;
set role trusted_migration_role;

do $pre_migration_schema_create$
begin
  if pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE') is distinct from false then
    raise exception 'service_role unexpectedly has CREATE on public before migration';
  end if;
  if pg_catalog.has_schema_privilege('trusted_migration_role', 'public', 'CREATE') is distinct from true then
    raise exception 'trusted migration role lacks CREATE on public';
  end if;
end;
$pre_migration_schema_create$;

create table public.leagues (
  id uuid primary key,
  slug text not null,
  status text not null,
  is_public boolean
);
create table public.seasons (
  id uuid primary key,
  league_id uuid not null,
  name text not null,
  start_date date,
  created_at timestamptz default pg_catalog.now()
);
create table public.teams (
  id uuid primary key,
  league_id uuid not null,
  division_id uuid,
  name text not null,
  slug text
);
create table public.profiles (
  id uuid primary key,
  full_name text,
  avatar_url text,
  photo_url text
);
create table public.games (
  id uuid primary key,
  league_id uuid not null,
  season_id uuid not null,
  status text not null,
  home_team_id uuid not null,
  away_team_id uuid not null,
  home_score integer,
  away_score integer,
  scheduled_at timestamptz not null,
  location text,
  penalty_capture_status text,
  goalie_capture_status text,
  skater_capture_status text
);
create table public.team_rosters (
  id uuid primary key,
  player_id uuid not null,
  team_id uuid not null,
  league_id uuid not null,
  season_id uuid not null,
  start_date date,
  end_date date,
  is_goalie boolean,
  position text,
  status text not null,
  player_type text not null,
  historical_retained boolean,
  games_played_override integer
);
create table public.game_checkins (
  id uuid primary key,
  game_id uuid not null,
  player_id uuid not null,
  team_id uuid not null,
  status text not null
);
create table public.player_availability (
  id uuid primary key,
  game_id uuid not null,
  player_id uuid not null,
  team_id uuid not null,
  season_id uuid not null,
  status text not null
);
create table public.sub_invitations (
  id uuid primary key,
  game_id uuid not null,
  invited_player_id uuid not null,
  team_id uuid not null,
  status text not null
);
create table public.player_stats (
  id uuid primary key,
  game_id uuid,
  player_id uuid not null,
  team_id uuid,
  league_id uuid not null,
  season_id uuid not null,
  goals integer,
  assists integer,
  penalty_minutes integer,
  scorekeeping_provenance text,
  created_at timestamptz
);
create table public.goalie_stats (
  id uuid primary key,
  game_id uuid,
  player_id uuid not null,
  team_id uuid,
  league_id uuid not null,
  season_id uuid not null,
  game_result text,
  saves integer,
  shots_against integer,
  goals_against integer,
  shutout boolean,
  scorekeeping_provenance text
);
create table public.game_goalie_appearances (
  game_id uuid not null,
  player_id uuid not null,
  team_id uuid not null,
  team_type text not null,
  primary key (game_id, player_id)
);
create table public.player_career_baselines (
  league_id uuid not null,
  player_id uuid,
  source_system text not null,
  source_batch_id text not null,
  games_played integer,
  goals integer,
  assists integer,
  points integer,
  wins integer,
  ties integer,
  saves integer,
  goals_against integer,
  shutouts integer,
  save_percentage numeric,
  goals_against_average numeric
);

-- Existing source-backed indexes reconstructed from repository schema/migrations.
create index idx_games_league_season on public.games (league_id, season_id);
create index idx_games_league_status on public.games (league_id, status);
create index idx_games_league_scheduled on public.games (league_id, scheduled_at);
create index idx_team_rosters_league_player on public.team_rosters (league_id, player_id);
create index idx_team_rosters_league_season on public.team_rosters (league_id, season_id);
create index idx_team_rosters_player on public.team_rosters (player_id, season_id);
create index idx_player_stats_league_player on public.player_stats (league_id, player_id);
create index idx_player_stats_league_season on public.player_stats (league_id, season_id);
create index idx_player_stats_league_game on public.player_stats (league_id, game_id);
create index idx_goalie_stats_league_player on public.goalie_stats (league_id, player_id);
create index idx_goalie_stats_league_season on public.goalie_stats (league_id, season_id);
create index idx_goalie_stats_league_game on public.goalie_stats (league_id, game_id);
create index idx_sub_invitations_game_team on public.sub_invitations (game_id, team_id);
create index idx_sub_invitations_player on public.sub_invitations (invited_player_id, status);
create index idx_player_career_baselines_league_player
  on public.player_career_baselines (league_id, player_id) where player_id is not null;

alter table public.leagues enable row level security;
alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.team_rosters enable row level security;
alter table public.game_checkins enable row level security;
alter table public.player_availability enable row level security;
alter table public.sub_invitations enable row level security;
alter table public.player_stats enable row level security;
alter table public.goalie_stats enable row level security;
alter table public.game_goalie_appearances enable row level security;
alter table public.player_career_baselines enable row level security;
revoke all on all tables in schema public from public, anon, authenticated;
grant select on all tables in schema public to service_role;

insert into public.leagues values
  ('d6e55507-6eae-4d94-978c-47c6c30a36f1', 'hockey-life', 'active', true),
  ('d6e55507-6eae-4d94-978c-47c6c30a36f2', 'private-hockey', 'active', false),
  ('d6e55507-6eae-4d94-978c-47c6c30a36f3', 'inactive-hockey', 'suspended', true),
  ('d6e55507-6eae-4d94-978c-47c6c30a36f4', 'distractor-hockey', 'active', true);
insert into public.seasons values
  ('20000000-0000-4000-8000-000000000001','d6e55507-6eae-4d94-978c-47c6c30a36f1','Spring 2026','2026-03-01',pg_catalog.now()),
  ('20000000-0000-4000-8000-000000000002','d6e55507-6eae-4d94-978c-47c6c30a36f1','Fall 2026','2026-09-01',pg_catalog.now()),
  ('20000000-0000-4000-8000-000000000003','d6e55507-6eae-4d94-978c-47c6c30a36f1','Unrelated 2027','2027-01-01',pg_catalog.now()),
  ('20000000-0000-4000-8000-000000000012','d6e55507-6eae-4d94-978c-47c6c30a36f2','Private','2026-09-01',pg_catalog.now()),
  ('20000000-0000-4000-8000-000000000013','d6e55507-6eae-4d94-978c-47c6c30a36f3','Inactive','2026-09-01',pg_catalog.now());
insert into public.teams values
  ('70000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1',null,'Home','home'),
  ('71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1',null,'Away','away'),
  ('71500000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1',null,'Game Only Opponent','game-only-opponent'),
  ('72000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1',null,'Unrelated','unrelated'),
  ('72500000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1',null,'Historical No Game','historical-no-game'),
  ('73000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f2',null,'Private','private'),
  ('74000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f3',null,'Inactive','inactive');
insert into public.profiles values
  ('bdd94b26-b344-459f-9727-8cddae9783df','Target',null,null),
  ('10000000-0000-4000-8000-000000000003','Related Goalie',null,null),
  ('10000000-0000-4000-8000-000000000004','Unrelated Goalie',null,null),
  ('10000000-0000-4000-8000-000000000005','Forged Child',null,null),
  ('10000000-0000-4000-8000-000000000006','Private Player',null,null),
  ('10000000-0000-4000-8000-000000000007','Inactive Player',null,null),
  ('10000000-0000-4000-8000-000000000008','Selected Season Sub Only',null,null),
  ('10000000-0000-4000-8000-000000000009','Malformed Sub Only',null,null);
insert into public.games values
  ('80000000-0000-4000-8000-000000000001','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','completed','70000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007',2,1,'2026-09-20T20:00:00Z','Arena','complete','complete','complete'),
  ('80000000-0000-4000-8000-000000000002','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','completed','72000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007',3,2,'2026-09-21T20:00:00Z','Unrelated Arena','complete','complete','complete'),
  ('80000000-0000-4000-8000-000000000003','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000012','completed','70000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007',9,9,'2026-09-22T20:00:00Z','Forged season','complete','complete','complete'),
  ('80000000-0000-4000-8000-000000000004','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','completed','73000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007',9,9,'2026-09-23T20:00:00Z','Forged team','complete','complete','complete'),
  ('80000000-0000-4000-8000-000000000005','d6e55507-6eae-4d94-978c-47c6c30a36f2','20000000-0000-4000-8000-000000000002','completed','70000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007',9,9,'2026-09-24T20:00:00Z','Forged league','complete','complete','complete'),
  ('80000000-0000-4000-8000-000000000006','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','completed','70000000-0000-4000-8000-000000000007','71000000-0000-4000-8000-000000000007',4,3,'2026-09-25T20:00:00Z','Accepted sub game','complete','complete','complete'),
  ('80000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','completed','70000000-0000-4000-8000-000000000007','71500000-0000-4000-8000-000000000007',1,0,'2026-09-26T20:00:00Z','Game-only team proof','complete','complete','complete');
insert into public.team_rosters values
  ('10000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','2026-09-01',null,false,'C','active','regular',false,null),
  ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','2026-09-01',null,true,'G','active','regular',false,null),
  ('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','2026-09-01',null,true,'G','inactive','regular',false,999),
  ('10000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000006','73000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f2','20000000-0000-4000-8000-000000000012','2026-09-01',null,false,'C','active','regular',false,null),
  ('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000007','74000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f3','20000000-0000-4000-8000-000000000013','2026-09-01',null,false,'C','active','regular',false,null),
  ('10000000-0000-4000-8000-000000000011','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000012','2026-09-01',null,false,'C','active','regular',false,null),
  ('10000000-0000-4000-8000-000000000012','bdd94b26-b344-459f-9727-8cddae9783df','73000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','2026-09-01',null,false,'C','active','regular',false,null),
  ('10000000-0000-4000-8000-000000000013','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','2026-09-01',null,false,'C','inactive','regular',false,null),
  ('10000000-0000-4000-8000-000000000014','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','2026-09-01',null,false,'C','active','part_time',false,null),
  ('10000000-0000-4000-8000-000000000015','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','2026-10-01',null,false,'C','active','regular',false,null),
  ('10000000-0000-4000-8000-000000000016','bdd94b26-b344-459f-9727-8cddae9783df','72500000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000001','2026-03-01','2026-04-30',false,'C','inactive','regular',true,7),
  ('10000000-0000-4000-8000-000000000017','10000000-0000-4000-8000-000000000008','72500000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000001','2026-03-01','2026-04-30',false,'C','inactive','regular',true,null),
  ('10000000-0000-4000-8000-000000000018','10000000-0000-4000-8000-000000000009','72500000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000001','2026-03-01','2026-04-30',false,'C','inactive','regular',true,null);
insert into public.game_checkins values
  ('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','confirmed'),
  ('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000007','confirmed'),
  ('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','confirmed'),
  ('90000000-0000-4000-8000-000000000098','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','confirmed'),
  ('90000000-0000-4000-8000-000000000099','80000000-0000-4000-8000-000000000006','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','confirmed'),
  ('90000000-0000-4000-8000-000000000007','80000000-0000-4000-8000-000000000007','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','confirmed');
insert into public.player_availability values
  ('91000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000002','out'),
  ('91000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001','out'),
  ('91000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000012','out'),
  ('91000000-0000-4000-8000-000000000098','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000002','out'),
  ('91000000-0000-4000-8000-000000000099','80000000-0000-4000-8000-000000000006','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000002','out');
insert into public.sub_invitations values
  ('92000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','accepted'),
  ('92000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000007','accepted'),
  ('92000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','accepted'),
  ('92000000-0000-4000-8000-000000000094','80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000009','70000000-0000-4000-8000-000000000007','accepted'),
  ('92000000-0000-4000-8000-000000000095','80000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000008','70000000-0000-4000-8000-000000000007','accepted'),
  ('92000000-0000-4000-8000-000000000096','80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000008','70000000-0000-4000-8000-000000000007','accepted'),
  ('92000000-0000-4000-8000-000000000097','80000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000008','70000000-0000-4000-8000-000000000007','accepted'),
  ('92000000-0000-4000-8000-000000000099','80000000-0000-4000-8000-000000000006','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','accepted');
insert into public.player_stats values
  ('a0000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002',2,1,0,'event_derived',pg_catalog.now()),
  ('a0000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','72000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000001',9,9,9,null,pg_catalog.now()),
  ('a0000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000012',9,9,9,null,pg_catalog.now()),
  ('a0000000-0000-4000-8000-000000000098','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002',9,9,9,'event_derived',pg_catalog.now()),
  ('a0000000-0000-4000-8000-000000000099','80000000-0000-4000-8000-000000000006','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002',1,1,0,'event_derived',pg_catalog.now());
insert into public.goalie_stats values
  ('b0000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','W',20,21,1,false,'event_derived'),
  ('b0000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','W',999,999,0,true,null),
  ('b0000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','72000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000001','W',999,999,0,true,null),
  ('b0000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000003','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000012','W',999,999,0,true,null),
  ('b0000000-0000-4000-8000-000000000098','80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','L',9,10,1,false,'event_derived'),
  ('b0000000-0000-4000-8000-000000000099','80000000-0000-4000-8000-000000000006','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f1','20000000-0000-4000-8000-000000000002','W',19,22,3,false,'event_derived');
insert into public.game_goalie_appearances values
  ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000007','away'),
  ('80000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000007','home'),
  ('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000007','away'),
  ('80000000-0000-4000-8000-000000000003','bdd94b26-b344-459f-9727-8cddae9783df','70000000-0000-4000-8000-000000000007','home'),
  ('80000000-0000-4000-8000-000000000001','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','away'),
  ('80000000-0000-4000-8000-000000000006','bdd94b26-b344-459f-9727-8cddae9783df','71000000-0000-4000-8000-000000000007','away');
insert into public.player_career_baselines values
  ('d6e55507-6eae-4d94-978c-47c6c30a36f1','bdd94b26-b344-459f-9727-8cddae9783df','legacy','batch-1',5,2,3,5,0,0,null,null,null,null,null);

-- A hostile same-signature function, owner, and direct grant must not survive forward apply.
create function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid default null)
returns jsonb language sql stable security definer set search_path = public
as $$ select '{}'::jsonb $$;
alter function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid)
  owner to hostile_function_owner;
grant execute on function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid)
  to hostile_extra_grantee;

\ir ../migrations/20261019011500_mobile_profile_phase_facts_v1.sql
\ir ../migrations/20261019040025_mobile_profile_roster_team_closure.sql
\ir ../migrations/20261019052543_mobile_profile_sub_scope_closure.sql
reset role;

do $post_migration_schema_create$
begin
  if pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE') is distinct from false then
    raise exception 'service_role CREATE on public was not restored after migration';
  end if;
end;
$post_migration_schema_create$;

-- Catalog, replacement, ACL, qualification, and pre-aggregation cap contract.
do $catalog$
declare
  v_owner text;
  v_config text[];
  v_definition text;
begin
  select pg_catalog.pg_get_userbyid(p.proowner), p.proconfig, pg_catalog.pg_get_functiondef(p.oid)
    into v_owner, v_config, v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'mobile_profile_phase_facts_v1'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) =
      'p_phase text, p_league_id uuid, p_player_id uuid, p_season_id uuid';

  if v_owner is distinct from 'service_role' then
    raise exception 'function owner is not service_role: %', v_owner;
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mobile_profile_phase_facts_v1'
      and p.prosecdef
  ) then
    raise exception 'function must be SECURITY INVOKER';
  end if;
  if v_config is distinct from array['search_path=pg_catalog']::text[] then
    raise exception 'function search_path must be pg_catalog only: %', v_config;
  end if;
  if pg_catalog.has_function_privilege('anon', 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)', 'execute')
     or pg_catalog.has_function_privilege('hostile_extra_grantee', 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)', 'execute')
     or not pg_catalog.has_function_privilege('service_role', 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)', 'execute') then
    raise exception 'function EXECUTE ACL is not service_role-only';
  end if;
  if v_definition ~* 'security definer'
     or v_definition !~* 'set search_path to ''pg_catalog'''
     or v_definition ~* '\m(from|join)\s+(seasons|teams|profiles|games|team_rosters|game_checkins|player_availability|sub_invitations|player_stats|goalie_stats|game_goalie_appearances|player_career_baselines)\M'
     or v_definition ~* '\mexecute\M' then
    raise exception 'function definition is not invoker/qualified/static';
  end if;
  if pg_catalog.strpos(v_definition, 'jsonb_agg') < pg_catalog.strpos(v_definition, 'mobile profile fact total cap exceeded') then
    raise exception 'JSON aggregation appears before cumulative cap preflight';
  end if;
end;
$catalog$;

-- Direct execution must be denied to every public/user token role.
set role anon;
do $anon_denied$
begin
  perform public.mobile_profile_phase_facts_v1(
    'timeline',
    'd6e55507-6eae-4d94-978c-47c6c30a36f1',
    'bdd94b26-b344-459f-9727-8cddae9783df',
    null
  );
  raise exception 'anon direct execution unexpectedly succeeded';
exception when insufficient_privilege then
  null;
end;
$anon_denied$;
reset role;

set role authenticated;
do $authenticated_denied$
begin
  perform public.mobile_profile_phase_facts_v1(
    'timeline',
    'd6e55507-6eae-4d94-978c-47c6c30a36f1',
    'bdd94b26-b344-459f-9727-8cddae9783df',
    null
  );
  raise exception 'authenticated direct execution unexpectedly succeeded';
exception when insufficient_privilege then
  null;
end;
$authenticated_denied$;
reset role;

-- The privileged invoker must execute every phase in a read-only transaction.
create temp table captured_phase_payloads (
  phase text primary key,
  payload jsonb not null
);
grant select, insert on captured_phase_payloads to service_role;
create temp table captured_sub_only_phase_results (
  phase text primary key,
  payload jsonb,
  error_state text,
  error_message text
);
grant select, insert on captured_sub_only_phase_results to service_role;
set role service_role;
begin read only;
insert into captured_phase_payloads
select 'selected_stats', public.mobile_profile_phase_facts_v1(
  'selected_stats',
  'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df',
  '20000000-0000-4000-8000-000000000002'
);
insert into captured_phase_payloads
select 'timeline', public.mobile_profile_phase_facts_v1(
  'timeline',
  'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df',
  null
);
insert into captured_phase_payloads
select 'game_log', public.mobile_profile_phase_facts_v1(
  'game_log',
  'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df',
  '20000000-0000-4000-8000-000000000002'
);
insert into captured_phase_payloads
select 'selected_stats_no_game', public.mobile_profile_phase_facts_v1(
  'selected_stats',
  'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df',
  '20000000-0000-4000-8000-000000000001'
);
insert into captured_phase_payloads
select 'game_log_no_game', public.mobile_profile_phase_facts_v1(
  'game_log',
  'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df',
  '20000000-0000-4000-8000-000000000001'
);
do $capture_sub_only_phases$
declare
  v_payload jsonb;
  v_state text;
  v_message text;
begin
  begin
    v_payload := public.mobile_profile_phase_facts_v1(
      'timeline',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      '10000000-0000-4000-8000-000000000008',
      null
    );
    insert into captured_sub_only_phase_results values ('timeline', v_payload, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    insert into captured_sub_only_phase_results values ('timeline', null, v_state, v_message);
  end;

  begin
    v_payload := public.mobile_profile_phase_facts_v1(
      'selected_stats',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      '10000000-0000-4000-8000-000000000008',
      '20000000-0000-4000-8000-000000000002'
    );
    insert into captured_sub_only_phase_results values ('selected_stats', v_payload, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    insert into captured_sub_only_phase_results values ('selected_stats', null, v_state, v_message);
  end;

  begin
    v_payload := public.mobile_profile_phase_facts_v1(
      'game_log',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      '10000000-0000-4000-8000-000000000008',
      '20000000-0000-4000-8000-000000000002'
    );
    insert into captured_sub_only_phase_results values ('game_log', v_payload, null, null);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    insert into captured_sub_only_phase_results values ('game_log', null, v_state, v_message);
  end;
end;
$capture_sub_only_phases$;
commit;

-- V14.6 regressions: a player with one historical league roster and only an
-- exact accepted-sub relationship in the selected season must retain that
-- canonical game season in timeline, and selected_stats/game_log must admit
-- the selected season without leaking unrelated facts.
do $accepted_sub_scope_closure$
declare
  v_result record;
  v_failures text[] := array[]::text[];
  v_expected_teams text[];
  v_expected_seasons text[];
begin
  if exists (
    select 1 from public.team_rosters tr
    where tr.player_id = '10000000-0000-4000-8000-000000000008'
      and tr.league_id = 'd6e55507-6eae-4d94-978c-47c6c30a36f1'
      and tr.season_id = '20000000-0000-4000-8000-000000000002'
  ) or exists (
    select 1 from public.player_stats ps
    where ps.player_id = '10000000-0000-4000-8000-000000000008'
      and ps.league_id = 'd6e55507-6eae-4d94-978c-47c6c30a36f1'
      and ps.season_id = '20000000-0000-4000-8000-000000000002'
  ) or exists (
    select 1 from public.goalie_stats gs
    where gs.player_id = '10000000-0000-4000-8000-000000000008'
      and gs.league_id = 'd6e55507-6eae-4d94-978c-47c6c30a36f1'
      and gs.season_id = '20000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'accepted-sub-only fixture unexpectedly has selected-season roster or stats';
  end if;

  if not exists (
    select 1
    from public.sub_invitations si
    join public.games g on g.id = si.game_id
    join public.seasons s on s.id = g.season_id and s.league_id = g.league_id
    join public.teams t on t.id = si.team_id and t.league_id = g.league_id
    where si.id = '92000000-0000-4000-8000-000000000097'
      and si.invited_player_id = '10000000-0000-4000-8000-000000000008'
      and si.status = 'accepted'
      and g.league_id = 'd6e55507-6eae-4d94-978c-47c6c30a36f1'
      and g.season_id = '20000000-0000-4000-8000-000000000002'
      and si.team_id in (g.home_team_id, g.away_team_id)
  ) then
    raise exception 'accepted-sub-only fixture lacks exact canonical selected-season authorization';
  end if;

  for v_result in
    select phase, payload, error_state, error_message
    from captured_sub_only_phase_results
    order by phase
  loop
    if v_result.error_state is not null then
      v_failures := pg_catalog.array_append(
        v_failures,
        v_result.phase || ' raised ' || v_result.error_state || ': ' || v_result.error_message
      );
      continue;
    end if;

    if v_result.payload #>> '{scope,league_id}' <> 'd6e55507-6eae-4d94-978c-47c6c30a36f1'
       or v_result.payload #>> '{scope,player_id}' <> '10000000-0000-4000-8000-000000000008'
       or (v_result.phase = 'timeline' and v_result.payload #> '{scope,season_id}' <> 'null'::jsonb)
       or (v_result.phase <> 'timeline' and v_result.payload #>> '{scope,season_id}' <> '20000000-0000-4000-8000-000000000002') then
      v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' returned the wrong scope');
    end if;

    if pg_catalog.jsonb_array_length(v_result.payload #> '{facts,games}') <> 1
       or v_result.payload #>> '{facts,games,0,id}' <> '80000000-0000-4000-8000-000000000007'
       or v_result.payload #>> '{facts,games,0,season_id}' <> '20000000-0000-4000-8000-000000000002' then
      v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' did not return the exact accepted-sub game');
    end if;

    if pg_catalog.jsonb_array_length(v_result.payload #> '{facts,acceptedSubs}') <> 1
       or v_result.payload #>> '{facts,acceptedSubs,0,id}' <> '92000000-0000-4000-8000-000000000097'
       or v_result.payload #>> '{facts,acceptedSubs,0,game_id}' <> '80000000-0000-4000-8000-000000000007'
       or v_result.payload #>> '{facts,acceptedSubs,0,team_id}' <> '70000000-0000-4000-8000-000000000007'
       or v_result.payload #>> '{facts,acceptedSubs,0,invited_player_id}' <> '10000000-0000-4000-8000-000000000008' then
      v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' did not return the exact accepted-sub fact');
    end if;

    v_expected_teams := case when v_result.phase = 'timeline' then
      array[
        '70000000-0000-4000-8000-000000000007',
        '71500000-0000-4000-8000-000000000007',
        '72500000-0000-4000-8000-000000000007'
      ]::text[]
    else
      array[
        '70000000-0000-4000-8000-000000000007',
        '71500000-0000-4000-8000-000000000007'
      ]::text[]
    end;
    if (
      select pg_catalog.array_agg(team->>'id' order by team->>'id')
      from pg_catalog.jsonb_array_elements(v_result.payload #> '{facts,teams}') team
    ) is distinct from v_expected_teams then
      v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' returned non-exact team facts');
    end if;

    if v_result.phase <> 'selected_stats' then
      v_expected_seasons := case when v_result.phase = 'timeline' then
        array[
          '20000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000002'
        ]::text[]
      else
        array['20000000-0000-4000-8000-000000000002']::text[]
      end;
      if (
        select pg_catalog.array_agg(season->>'id' order by season->>'id')
        from pg_catalog.jsonb_array_elements(v_result.payload #> '{facts,seasons}') season
      ) is distinct from v_expected_seasons then
        v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' returned non-exact season facts');
      end if;
      if exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_result.payload #> '{facts,games}') game
        where not exists (
          select 1
          from pg_catalog.jsonb_array_elements(v_result.payload #> '{facts,seasons}') season
          where season->>'id' = game->>'season_id'
        )
      ) then
        v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' emitted a game with an unresolved season');
      end if;
    elsif v_result.payload #> '{facts,seasons}' is not null then
      v_failures := pg_catalog.array_append(v_failures, 'selected_stats unexpectedly changed its source schema');
    end if;

    if pg_catalog.jsonb_array_length(v_result.payload #> '{facts,profiles}') <> 1
       or v_result.payload #>> '{facts,profiles,0,id}' <> '10000000-0000-4000-8000-000000000008' then
      v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' leaked an unrelated profile');
    end if;

    if (v_result.phase = 'timeline' and (
      pg_catalog.jsonb_array_length(v_result.payload #> '{facts,rosters}') <> 1
      or v_result.payload #>> '{facts,rosters,0,id}' <> '10000000-0000-4000-8000-000000000017'
    )) or (v_result.phase <> 'timeline' and pg_catalog.jsonb_array_length(v_result.payload #> '{facts,rosters}') <> 0) then
      v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' returned non-exact roster facts');
    end if;

    if pg_catalog.jsonb_array_length(v_result.payload #> '{facts,checkins}') <> 0
       or pg_catalog.jsonb_array_length(v_result.payload #> '{facts,availabilities}') <> 0
       or pg_catalog.jsonb_array_length(v_result.payload #> '{facts,playerStats}') <> 0
       or pg_catalog.jsonb_array_length(v_result.payload #> '{facts,goalieStats}') <> 0
       or pg_catalog.jsonb_array_length(v_result.payload #> '{facts,goalieAppearances}') <> 0 then
      v_failures := pg_catalog.array_append(v_failures, v_result.phase || ' leaked unrelated player child facts');
    end if;
  end loop;

  if (select pg_catalog.count(*) from captured_sub_only_phase_results) <> 3 then
    v_failures := pg_catalog.array_append(v_failures, 'not all accepted-sub-only phases were captured');
  end if;

  if pg_catalog.array_length(v_failures, 1) is not null then
    raise exception 'V14.6 accepted-sub scope closure failed: %', pg_catalog.array_to_string(v_failures, '; ');
  end if;
end;
$accepted_sub_scope_closure$;
reset role;

-- A target player's valid historical roster remains a first-class fact even
-- when its same-league team has no qualifying game. Every emitted roster team
-- must be present in the phase-local team dictionary.
do $roster_team_closure$
declare
  v_phase record;
begin
  if exists (
    select 1
    from public.games g
    where g.league_id = 'd6e55507-6eae-4d94-978c-47c6c30a36f1'
      and g.season_id = '20000000-0000-4000-8000-000000000001'
      and '72500000-0000-4000-8000-000000000007' in (g.home_team_id, g.away_team_id)
  ) then
    raise exception 'no-game roster fixture unexpectedly has a qualifying game';
  end if;

  for v_phase in
    select phase, payload
    from captured_phase_payloads
  loop
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_phase.payload #> '{facts,rosters}') roster
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_phase.payload #> '{facts,teams}') team
        where team->>'id' = roster->>'team_id'
      )
    ) then
      raise exception 'emitted roster team is unresolved in phase %', v_phase.phase;
    end if;
  end loop;

  if exists (
    select 1
    from (values ('timeline'), ('selected_stats_no_game'), ('game_log_no_game')) required(phase)
    where not exists (
      select 1
      from captured_phase_payloads captured
      cross join lateral pg_catalog.jsonb_array_elements(captured.payload #> '{facts,rosters}') roster
      where captured.phase = required.phase
        and roster->>'id' = '10000000-0000-4000-8000-000000000016'
    )
  )
  or exists (
    select 1
    from (values ('timeline'), ('selected_stats_no_game'), ('game_log_no_game')) required(phase)
    where not exists (
      select 1
      from captured_phase_payloads captured
      cross join lateral pg_catalog.jsonb_array_elements(captured.payload #> '{facts,teams}') team
      where captured.phase = required.phase
        and team->>'id' = '72500000-0000-4000-8000-000000000007'
    )
  ) then
    raise exception 'target no-game roster/team closure is incomplete';
  end if;

  if exists (
    select 1
    from captured_phase_payloads captured
    cross join lateral pg_catalog.jsonb_array_elements(captured.payload #> '{facts,games}') game
    where captured.phase in ('selected_stats_no_game', 'game_log_no_game')
  ) then
    raise exception 'no-game selected season unexpectedly emitted a game';
  end if;
end;
$roster_team_closure$;

-- Keep the roster closure narrow while proving the pre-existing game-derived
-- team and selected competing-goalie branches remain independently necessary.
do $team_scope_retention$
declare
  v_selected jsonb;
begin
  if exists (
    select 1
    from public.team_rosters tr
    where tr.player_id = 'bdd94b26-b344-459f-9727-8cddae9783df'
      and tr.team_id = '71500000-0000-4000-8000-000000000007'
  ) then
    raise exception 'game-only opponent fixture unexpectedly has a target-player roster';
  end if;

  if exists (
    select 1
    from captured_phase_payloads captured
    cross join lateral pg_catalog.jsonb_array_elements(captured.payload #> '{facts,teams}') team
    where team->>'id' in (
      '72000000-0000-4000-8000-000000000007',
      '73000000-0000-4000-8000-000000000007',
      '74000000-0000-4000-8000-000000000007'
    )
  ) then
    raise exception 'unrelated or cross-league team leaked through facts.teams';
  end if;

  if exists (
    select 1
    from (values ('timeline'), ('selected_stats'), ('game_log')) required(phase)
    where not exists (
      select 1
      from captured_phase_payloads captured
      cross join lateral pg_catalog.jsonb_array_elements(captured.payload #> '{facts,games}') game
      where captured.phase = required.phase
        and game->>'id' = '80000000-0000-4000-8000-000000000007'
    )
      or not exists (
        select 1
        from captured_phase_payloads captured
        cross join lateral pg_catalog.jsonb_array_elements(captured.payload #> '{facts,teams}') team
        where captured.phase = required.phase
          and team->>'id' = '71500000-0000-4000-8000-000000000007'
      )
  ) then
    raise exception 'authorized game-only opponent team was not preserved';
  end if;

  select payload into v_selected
  from captured_phase_payloads
  where phase = 'selected_stats';

  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,rosters}') row
    where row->>'id' = '10000000-0000-4000-8000-000000000002'
      and row->>'player_id' = '10000000-0000-4000-8000-000000000003'
  ) or not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,goalieStats}') row
    where row->>'id' = 'b0000000-0000-4000-8000-000000000001'
      and row->>'player_id' = '10000000-0000-4000-8000-000000000003'
  ) or not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,goalieAppearances}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000001'
      and row->>'player_id' = '10000000-0000-4000-8000-000000000003'
      and row->>'team_id' = '71000000-0000-4000-8000-000000000007'
      and row->>'team_type' = 'away'
  ) then
    raise exception 'selected competing-goalie facts were not preserved';
  end if;
end;
$team_scope_retention$;

-- Null, unknown, malformed/enumerated UUIDs, private/inactive tenants, and an
-- unrelated selected-season player are all denied by the function itself.
do $scope$
begin
  begin
    perform public.mobile_profile_phase_facts_v1(null, 'd6e55507-6eae-4d94-978c-47c6c30a36f1', 'bdd94b26-b344-459f-9727-8cddae9783df', null);
    raise exception 'null phase accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('unknown', 'd6e55507-6eae-4d94-978c-47c6c30a36f1', 'bdd94b26-b344-459f-9727-8cddae9783df', null);
    raise exception 'unknown phase accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('timeline', null, 'bdd94b26-b344-459f-9727-8cddae9783df', null);
    raise exception 'null league accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('timeline', 'd6e55507-6eae-4d94-978c-47c6c30a36f1', null, null);
    raise exception 'null player accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('timeline', 'd6e55507-6eae-4d94-978c-47c6c30a36f2', '10000000-0000-4000-8000-000000000006', null);
    raise exception 'private league accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('timeline', 'd6e55507-6eae-4d94-978c-47c6c30a36f3', '10000000-0000-4000-8000-000000000007', null);
    raise exception 'inactive league accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('timeline', 'd6e55507-6eae-4d94-978c-47c6c30a36ff', 'bdd94b26-b344-459f-9727-8cddae9783df', null);
    raise exception 'enumerated league UUID accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('timeline', 'd6e55507-6eae-4d94-978c-47c6c30a36f1', 'bdd94b26-b344-459f-9727-8cddae9783ff', null);
    raise exception 'enumerated player UUID accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('selected_stats', 'd6e55507-6eae-4d94-978c-47c6c30a36f1', 'bdd94b26-b344-459f-9727-8cddae9783df', '20000000-0000-4000-8000-000000000003');
    raise exception 'player unrelated to selected season accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.mobile_profile_phase_facts_v1('selected_stats', 'd6e55507-6eae-4d94-978c-47c6c30a36f1', '10000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000002');
    raise exception 'non-participating-team accepted sub admitted selected season';
  exception when sqlstate '22023' then null; end;
  begin
    execute $sql$select public.mobile_profile_phase_facts_v1('timeline', 'not-a-uuid', 'bdd94b26-b344-459f-9727-8cddae9783df', null)$sql$;
    raise exception 'malformed UUID accepted';
  exception when invalid_text_representation then null; end;
end;
$scope$;

-- Forged child relationships and unrelated other-player season facts must not
-- cross the SQL boundary. Exact target rows remain present.
do $relationships$
declare
  v_selected jsonb;
  v_timeline jsonb;
begin
  select payload into v_selected
  from captured_phase_payloads
  where phase = 'selected_stats';
  select payload into v_timeline
  from captured_phase_payloads
  where phase = 'timeline';
  if exists (
    select 1
    from (values
      ('checkins', '90000000-0000-4000-8000-000000000098'),
      ('availabilities', '91000000-0000-4000-8000-000000000098'),
      ('playerStats', 'a0000000-0000-4000-8000-000000000098'),
      ('goalieStats', 'b0000000-0000-4000-8000-000000000098')
    ) forged(source_name, row_id)
    where exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_selected #> array['facts', forged.source_name]) row
      where row->>'id' = forged.row_id
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,goalieAppearances}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000001'
      and row->>'player_id' = 'bdd94b26-b344-459f-9727-8cddae9783df'
      and row->>'team_id' = '71000000-0000-4000-8000-000000000007'
  ) then
    raise exception 'opposing participating-team target child survived exact authorization';
  end if;
  if exists (
    select 1
    from (values
      ('checkins', '90000000-0000-4000-8000-000000000099'),
      ('availabilities', '91000000-0000-4000-8000-000000000099'),
      ('acceptedSubs', '92000000-0000-4000-8000-000000000099'),
      ('playerStats', 'a0000000-0000-4000-8000-000000000099'),
      ('goalieStats', 'b0000000-0000-4000-8000-000000000099')
    ) supported(source_name, row_id)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_selected #> array['facts', supported.source_name]) row
      where row->>'id' = supported.row_id
    )
  ) or not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,goalieAppearances}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000006'
      and row->>'player_id' = 'bdd94b26-b344-459f-9727-8cddae9783df'
      and row->>'team_id' = '71000000-0000-4000-8000-000000000007'
  ) then
    raise exception 'accepted-sub exact authorization evidence was not preserved';
  end if;
  if pg_catalog.jsonb_array_length(v_selected #> '{facts,acceptedSubs}') <> 2 then
    raise exception 'accepted substitute scope changed unexpectedly: %', v_selected->'counts';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,rosters}') row
    where row->>'player_id' = '10000000-0000-4000-8000-000000000004'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,goalieStats}') row
    where row->>'player_id' = '10000000-0000-4000-8000-000000000004'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_selected #> '{facts,goalieAppearances}') row
    where row->>'player_id' in ('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005')
  ) then
    raise exception 'unrelated/forged other-player facts were returned';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,games}') row
    where row->>'id' in (
      '80000000-0000-4000-8000-000000000003',
      '80000000-0000-4000-8000-000000000004',
      '80000000-0000-4000-8000-000000000005'
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,rosters}') row
    where row->>'id' in (
      '10000000-0000-4000-8000-000000000011',
      '10000000-0000-4000-8000-000000000012'
    )
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,checkins}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,availabilities}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,acceptedSubs}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,playerStats}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,goalieStats}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000003'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_timeline #> '{facts,goalieAppearances}') row
    where row->>'game_id' = '80000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'forged game-season/team/league relationship was returned';
  end if;
end;
$relationships$;
reset role;

-- Exact cumulative cap boundary: build to exactly 5,000 returned fact rows,
-- then add one more. Both checks execute through the actual service_role.
do $cap_fill$
declare
  v_base_total integer;
  v_fill integer;
begin
  select (public.mobile_profile_phase_facts_v1(
    'timeline',
    'd6e55507-6eae-4d94-978c-47c6c30a36f1',
    'bdd94b26-b344-459f-9727-8cddae9783df',
    null
  ) #>> '{counts,total}')::integer into v_base_total;
  v_fill := 5000 - v_base_total;
  if v_fill < 1 then
    raise exception 'base fixture unexpectedly at/over cap: %', v_base_total;
  end if;
  insert into public.player_career_baselines (
    league_id, player_id, source_system, source_batch_id, games_played,
    goals, assists, points, wins, ties, saves, goals_against, shutouts,
    save_percentage, goals_against_average
  )
  select
    'd6e55507-6eae-4d94-978c-47c6c30a36f1',
    'bdd94b26-b344-459f-9727-8cddae9783df',
    'cap-fixture', 'cap-' || n::text, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  from pg_catalog.generate_series(1, v_fill) n;
end;
$cap_fill$;
set role service_role;
do $cap_exact$
declare
  v_payload jsonb;
begin
  v_payload := public.mobile_profile_phase_facts_v1(
    'timeline',
    'd6e55507-6eae-4d94-978c-47c6c30a36f1',
    'bdd94b26-b344-459f-9727-8cddae9783df',
    null
  );
  if (v_payload #>> '{counts,total}')::integer <> 5000 then
    raise exception 'exact cumulative cap did not return 5000 rows';
  end if;
  if pg_catalog.octet_length(v_payload::text) > 8388608 then
    raise exception 'database returned more than 8 MiB at exact cap';
  end if;
end;
$cap_exact$;
reset role;
insert into public.player_career_baselines values
  ('d6e55507-6eae-4d94-978c-47c6c30a36f1','bdd94b26-b344-459f-9727-8cddae9783df','cap-fixture','cap-over',0,0,0,0,0,0,0,0,0,0,0);
set role service_role;
do $cap_over$
begin
  begin
    perform public.mobile_profile_phase_facts_v1(
      'timeline',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      'bdd94b26-b344-459f-9727-8cddae9783df',
      null
    );
    raise exception 'cumulative cap+1 accepted';
  exception when sqlstate '54000' then null; end;
end;
$cap_over$;
reset role;
delete from public.player_career_baselines where source_system = 'cap-fixture';

-- The per-source boundary is independent: 5,000 rows pass the source check
-- (then fail the stricter cumulative check because mandatory scope rows exist),
-- while 5,001 rows fail the source check first.
insert into public.player_career_baselines (
  league_id, player_id, source_system, source_batch_id, games_played,
  goals, assists, points, wins, ties, saves, goals_against, shutouts,
  save_percentage, goals_against_average
)
select
  'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df',
  'source-cap-fixture', 'source-' || n::text, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
from pg_catalog.generate_series(1, 4999) n;
set role service_role;
do $source_exact$
declare
  v_message text;
begin
  begin
    perform public.mobile_profile_phase_facts_v1(
      'timeline',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      'bdd94b26-b344-459f-9727-8cddae9783df',
      null
    );
    raise exception '5,000-row source unexpectedly bypassed cumulative cap';
  exception when sqlstate '54000' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'mobile profile fact total cap exceeded' then
      raise exception '5,000-row source failed wrong cap: %', v_message;
    end if;
  end;
end;
$source_exact$;
reset role;
insert into public.player_career_baselines values
  ('d6e55507-6eae-4d94-978c-47c6c30a36f1','bdd94b26-b344-459f-9727-8cddae9783df','source-cap-fixture','source-over',0,0,0,0,0,0,0,0,0,0,0);
set role service_role;
do $source_over$
declare
  v_message text;
begin
  begin
    perform public.mobile_profile_phase_facts_v1(
      'timeline',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      'bdd94b26-b344-459f-9727-8cddae9783df',
      null
    );
    raise exception '5,001-row source accepted';
  exception when sqlstate '54000' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'mobile profile fact source cap exceeded' then
      raise exception '5,001-row source failed wrong cap: %', v_message;
    end if;
  end;
end;
$source_over$;
reset role;
delete from public.player_career_baselines where source_system = 'source-cap-fixture';
vacuum analyze public.player_career_baselines;

-- A same-player cap must stop from a source-backed index after cap+1 tuples.
-- auto_explain provides the exact nested plan; table/index counters make the
-- access bound deterministic rather than timing-dependent.
insert into public.player_career_baselines (
  league_id, player_id, source_system, source_batch_id, games_played,
  goals, assists, points, wins, ties, saves, goals_against, shutouts,
  save_percentage, goals_against_average
)
select
  'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df',
  'same-player-20k', 'same-player-' || pg_catalog.lpad(n::text, 6, '0'),
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
from pg_catalog.generate_series(1, 20000) n;
analyze public.player_career_baselines;
load 'auto_explain';
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set auto_explain.log_min_duration = 0;
select pg_catalog.pg_stat_force_next_flush();
select pg_catalog.pg_stat_reset_single_table_counters('public.player_career_baselines'::regclass);
do $reset_baseline_index$
declare
  v_index regclass := pg_catalog.to_regclass('public.idx_mobile_profile_v14_2_baselines_scope_order');
begin
  if v_index is not null then
    perform pg_catalog.pg_stat_reset_single_table_counters(v_index);
  end if;
end;
$reset_baseline_index$;
select pg_catalog.pg_stat_clear_snapshot();
do $same_player_marker$ begin raise log 'V14_2_SAME_PLAYER_20K_BEGIN'; end $same_player_marker$;
set role service_role;
do $same_player_cap$
declare
  v_message text;
begin
  begin
    perform public.mobile_profile_phase_facts_v1(
      'timeline',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      'bdd94b26-b344-459f-9727-8cddae9783df',
      null
    );
    raise exception '20,001 same-player source rows were accepted';
  exception when sqlstate '54000' then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'mobile profile fact source cap exceeded' then
      raise exception '20,001 same-player rows failed wrong cap: %', v_message;
    end if;
  end;
end;
$same_player_cap$;
reset role;
select pg_catalog.pg_stat_force_next_flush();
select pg_catalog.pg_stat_clear_snapshot();
do $same_player_access$
declare
  v_seq_scan bigint;
  v_seq_tup_read bigint;
  v_index regclass;
  v_idx_scan bigint;
  v_idx_tup_read bigint;
  v_idx_tup_fetch bigint;
begin
  select seq_scan, seq_tup_read
    into v_seq_scan, v_seq_tup_read
  from pg_catalog.pg_stat_all_tables
  where relid = 'public.player_career_baselines'::regclass;
  if v_seq_scan <> 0 or v_seq_tup_read <> 0 then
    raise exception 'same-player source used growing sequential access: scans=% tuples=%',
      v_seq_scan, v_seq_tup_read;
  end if;
  v_index := pg_catalog.to_regclass('public.idx_mobile_profile_v14_2_baselines_scope_order');
  if v_index is null then
    raise exception 'same-player source is missing the source-backed cap index';
  end if;
  select idx_scan, idx_tup_read, idx_tup_fetch
    into v_idx_scan, v_idx_tup_read, v_idx_tup_fetch
  from pg_catalog.pg_stat_all_indexes
  where indexrelid = v_index;
  if v_idx_scan < 1 or v_idx_tup_read > 5001 or v_idx_tup_fetch > 5001 then
    raise exception 'same-player source exceeded cap+1 index access: scans=% read=% fetched=%',
      v_idx_scan, v_idx_tup_read, v_idx_tup_fetch;
  end if;
  raise log 'V14_2_SAME_PLAYER_ACCESS seq_scan=% seq_tup_read=% idx_scan=% idx_tup_read=% idx_tup_fetch=%',
    v_seq_scan, v_seq_tup_read, v_idx_scan, v_idx_tup_read, v_idx_tup_fetch;
end;
$same_player_access$;
do $same_player_marker$ begin raise log 'V14_2_SAME_PLAYER_20K_END'; end $same_player_marker$;
delete from public.player_career_baselines where source_system = 'same-player-20k';

-- A single oversized text value is rejected before JSON aggregation and no
-- database response over 8 MiB is returned.
update public.profiles
set full_name = pg_catalog.repeat('x', 8 * 1024 * 1024 + 1)
where id = 'bdd94b26-b344-459f-9727-8cddae9783df';
set role service_role;
do $oversized$
begin
  begin
    perform public.mobile_profile_phase_facts_v1(
      'timeline',
      'd6e55507-6eae-4d94-978c-47c6c30a36f1',
      'bdd94b26-b344-459f-9727-8cddae9783df',
      null
    );
    raise exception 'oversized text accepted';
  exception when sqlstate '54000' then null; end;
end;
$oversized$;
reset role;
update public.profiles set full_name = 'Target'
where id = 'bdd94b26-b344-459f-9727-8cddae9783df';

-- 20k cross-tenant distractors exercise source-backed plans. The fixture adds
-- no review-only index; any candidate index must come from the forward migration.
insert into public.seasons values
  ('20000000-0000-4000-8000-000000000014','d6e55507-6eae-4d94-978c-47c6c30a36f4','Distractor','2026-09-01',pg_catalog.now());
insert into public.teams values
  ('75000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f4',null,'Distractor Home','d-home'),
  ('76000000-0000-4000-8000-000000000007','d6e55507-6eae-4d94-978c-47c6c30a36f4',null,'Distractor Away','d-away');
insert into public.games (
  id, league_id, season_id, status, home_team_id, away_team_id,
  home_score, away_score, scheduled_at
)
select
  pg_catalog.md5('distractor-game-' || n::text)::uuid,
  'd6e55507-6eae-4d94-978c-47c6c30a36f4',
  '20000000-0000-4000-8000-000000000014',
  'completed',
  '75000000-0000-4000-8000-000000000007',
  '76000000-0000-4000-8000-000000000007',
  1, 0, '2026-09-01T00:00:00Z'::timestamptz + n * interval '1 minute'
from pg_catalog.generate_series(1, 20000) n;
insert into public.team_rosters (
  id, player_id, team_id, league_id, season_id, start_date, end_date,
  is_goalie, position, status, player_type, historical_retained, games_played_override
)
select
  pg_catalog.md5('distractor-roster-' || n::text)::uuid,
  pg_catalog.md5('distractor-player-' || n::text)::uuid,
  '75000000-0000-4000-8000-000000000007',
  'd6e55507-6eae-4d94-978c-47c6c30a36f4',
  '20000000-0000-4000-8000-000000000014',
  '2026-09-01', null, false, 'C', 'active', 'regular', false, null
from pg_catalog.generate_series(1, 20000) n;
insert into public.game_checkins (id, game_id, player_id, team_id, status)
select pg_catalog.md5('distractor-checkin-' || n::text)::uuid,
  pg_catalog.md5('distractor-game-' || n::text)::uuid,
  pg_catalog.md5('distractor-player-' || n::text)::uuid,
  '75000000-0000-4000-8000-000000000007', 'confirmed'
from pg_catalog.generate_series(1, 20000) n;
insert into public.player_availability (id, game_id, player_id, team_id, season_id, status)
select pg_catalog.md5('distractor-availability-' || n::text)::uuid,
  pg_catalog.md5('distractor-game-' || n::text)::uuid,
  pg_catalog.md5('distractor-player-' || n::text)::uuid,
  '75000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000014', 'out'
from pg_catalog.generate_series(1, 20000) n;
insert into public.sub_invitations (id, game_id, invited_player_id, team_id, status)
select pg_catalog.md5('distractor-sub-' || n::text)::uuid,
  pg_catalog.md5('distractor-game-' || n::text)::uuid,
  pg_catalog.md5('distractor-player-' || n::text)::uuid,
  '75000000-0000-4000-8000-000000000007', 'accepted'
from pg_catalog.generate_series(1, 20000) n;
insert into public.player_stats (
  id, game_id, player_id, team_id, league_id, season_id, goals, assists,
  penalty_minutes, scorekeeping_provenance, created_at
)
select pg_catalog.md5('distractor-player-stat-' || n::text)::uuid,
  pg_catalog.md5('distractor-game-' || n::text)::uuid,
  pg_catalog.md5('distractor-player-' || n::text)::uuid,
  '75000000-0000-4000-8000-000000000007',
  'd6e55507-6eae-4d94-978c-47c6c30a36f4',
  '20000000-0000-4000-8000-000000000014', 0, 0, 0, null, pg_catalog.now()
from pg_catalog.generate_series(1, 20000) n;
insert into public.goalie_stats (
  id, game_id, player_id, team_id, league_id, season_id, game_result,
  saves, shots_against, goals_against, shutout, scorekeeping_provenance
)
select pg_catalog.md5('distractor-goalie-stat-' || n::text)::uuid,
  pg_catalog.md5('distractor-game-' || n::text)::uuid,
  pg_catalog.md5('distractor-player-' || n::text)::uuid,
  '75000000-0000-4000-8000-000000000007',
  'd6e55507-6eae-4d94-978c-47c6c30a36f4',
  '20000000-0000-4000-8000-000000000014', 'W', 1, 1, 0, true, null
from pg_catalog.generate_series(1, 20000) n;
insert into public.game_goalie_appearances (game_id, player_id, team_id, team_type)
select pg_catalog.md5('distractor-game-' || n::text)::uuid,
  pg_catalog.md5('distractor-player-' || n::text)::uuid,
  '75000000-0000-4000-8000-000000000007', 'home'
from pg_catalog.generate_series(1, 20000) n;
analyze public.games;
analyze public.team_rosters;
analyze public.game_checkins;
analyze public.player_availability;
analyze public.sub_invitations;
analyze public.player_stats;
analyze public.goalie_stats;
analyze public.game_goalie_appearances;

load 'auto_explain';
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set auto_explain.log_min_duration = 0;
do $cross_tenant_marker$ begin raise log 'V14_2_CROSS_TENANT_20K_BEGIN'; end $cross_tenant_marker$;
set role service_role;
set statement_timeout = '3s';
begin read only;
explain (analyze, buffers, format text)
select public.mobile_profile_phase_facts_v1(
  'selected_stats', 'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df', '20000000-0000-4000-8000-000000000002'
);
explain (analyze, buffers, format text)
select public.mobile_profile_phase_facts_v1(
  'timeline', 'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df', null
);
explain (analyze, buffers, format text)
select public.mobile_profile_phase_facts_v1(
  'game_log', 'd6e55507-6eae-4d94-978c-47c6c30a36f1',
  'bdd94b26-b344-459f-9727-8cddae9783df', '20000000-0000-4000-8000-000000000002'
);
commit;
reset role;
do $cross_tenant_marker$ begin raise log 'V14_2_CROSS_TENANT_20K_END'; end $cross_tenant_marker$;

-- Reapply must clear a hostile direct grant. Drop plus reapply proves a clean
-- forward installation after an explicit rollback-equivalent removal.
grant execute on function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid)
  to hostile_extra_grantee;
set role trusted_migration_role;
\ir ../migrations/20261019011500_mobile_profile_phase_facts_v1.sql
\ir ../migrations/20261019040025_mobile_profile_roster_team_closure.sql
\ir ../migrations/20261019052543_mobile_profile_sub_scope_closure.sql
reset role;

do $reapply$
begin
  if pg_catalog.has_function_privilege('hostile_extra_grantee', 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)', 'execute') then
    raise exception 'hostile direct grant survived same-signature reapply';
  end if;
  if pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE') is distinct from false then
    raise exception 'service_role CREATE on public was not restored after hostile reapply';
  end if;
end;
$reapply$;

drop function public.mobile_profile_phase_facts_v1(text, uuid, uuid, uuid);
set role trusted_migration_role;
\ir ../migrations/20261019011500_mobile_profile_phase_facts_v1.sql
\ir ../migrations/20261019040025_mobile_profile_roster_team_closure.sql
\ir ../migrations/20261019052543_mobile_profile_sub_scope_closure.sql
reset role;

do $clean_reapply$
begin
  if not pg_catalog.has_function_privilege('service_role', 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)', 'execute')
     or pg_catalog.has_function_privilege('anon', 'public.mobile_profile_phase_facts_v1(text,uuid,uuid,uuid)', 'execute') then
    raise exception 'clean reapply ACL mismatch';
  end if;
  if pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE') is distinct from false then
    raise exception 'service_role CREATE on public was not restored after clean reapply';
  end if;
end;
$clean_reapply$;

select 'mobile_profile_phase_facts_v1_security_test: PASS' as result;
