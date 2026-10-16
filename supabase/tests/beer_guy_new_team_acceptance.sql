\set ON_ERROR_STOP on

INSERT INTO public.teams(id, league_id, name)
VALUES ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'Expansion Team');

DO $new_team$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.duty_types
      WHERE team_id = '30000000-0000-4000-8000-000000000004' AND system_key = 'beer_guy') <> 1 THEN
    RAISE EXCEPTION 'new team did not receive exactly one canonical Beer Guy duty';
  END IF;
END;
$new_team$;

SELECT 'beer guy new-team provisioning acceptance passed' AS result;
