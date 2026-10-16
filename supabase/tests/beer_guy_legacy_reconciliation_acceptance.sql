\set ON_ERROR_STOP on

DO $legacy_reconciliation$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.game_duties
    WHERE id = '70000000-0000-4000-8000-000000000011'
      AND assigned_player_id = '40000000-0000-4000-8000-000000000012'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'confirmed eligible future legacy Beer assignment was not retained';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.game_duties
    WHERE id IN (
      '70000000-0000-4000-8000-000000000012',
      '70000000-0000-4000-8000-000000000014'
    )
      AND assigned_player_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'unconfirmed or accepted-sub future legacy Beer assignment was not reopened: %',
      (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(gd))
       FROM public.game_duties AS gd
       WHERE gd.id IN (
         '70000000-0000-4000-8000-000000000012',
         '70000000-0000-4000-8000-000000000014'
       ));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.game_duties
    WHERE id = '70000000-0000-4000-8000-000000000013'
      AND assigned_player_id = '40000000-0000-4000-8000-000000000020'
      AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'completed legacy Beer assignment was not backfilled after duty adoption';
  END IF;
END;
$legacy_reconciliation$;

SELECT 'beer guy legacy reconciliation and completed-history backfill acceptance passed' AS result;
