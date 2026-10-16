\set ON_ERROR_STOP on

DO $realtime_publication$
DECLARE
  v_missing text;
  v_publication pg_catalog.pg_publication%ROWTYPE;
BEGIN
  SELECT * INTO v_publication
  FROM pg_catalog.pg_publication
  WHERE pubname = 'supabase_realtime';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supabase_realtime publication is missing after migration';
  END IF;
  IF NOT (v_publication.pubinsert AND v_publication.pubupdate AND v_publication.pubdelete) THEN
    RAISE EXCEPTION 'supabase_realtime does not publish every subscribed row-change operation';
  END IF;

  SELECT pg_catalog.string_agg(required.table_name, ', ' ORDER BY required.table_name)
  INTO v_missing
  FROM (
    VALUES ('game_checkins'), ('game_duties')
  ) AS required(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS tbl
    JOIN pg_catalog.pg_namespace AS ns ON ns.oid = tbl.relnamespace
    WHERE tbl.oid IN (
        SELECT publication_tables.relid
        FROM pg_catalog.pg_get_publication_tables('supabase_realtime')
          AS publication_tables
      )
      AND ns.nspname = 'public'
      AND tbl.relname = required.table_name
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Realtime publication is missing subscribed tables: %', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_rel AS publication_table
    JOIN pg_catalog.pg_publication AS publication
      ON publication.oid = publication_table.prpubid
    WHERE publication.pubname = 'supabase_realtime'
      AND publication_table.prrelid IN (
        'public.game_checkins'::pg_catalog.regclass,
        'public.game_duties'::pg_catalog.regclass
      )
      AND (
        publication_table.prqual IS NOT NULL
        OR publication_table.prattrs IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Realtime subscribed tables retained incompatible row/column filters';
  END IF;
END;
$realtime_publication$;

SELECT 'beer guy Realtime publication acceptance passed' AS result;
