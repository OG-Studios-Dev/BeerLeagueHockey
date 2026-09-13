\set ON_ERROR_STOP on

-- This must fail against the pre-fix implementation with SQLSTATE 42P10:
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".
select public.rollup_game_stats('60000000-0000-4000-8000-000000000001');

