\set ON_ERROR_STOP on

DO $null_rejection$
BEGIN
  IF (SELECT attribute.attnotnull
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
        AND attribute.attname = 'timezone'
        AND NOT attribute.attisdropped) THEN
    RAISE EXCEPTION 'failed NULL-baseline migration left timezone NOT NULL';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.leagues WHERE timezone IS NULL) THEN
    RAISE EXCEPTION 'failed NULL-baseline migration changed or removed the NULL row';
  END IF;

  IF EXISTS (
    (SELECT id, timezone_bytes
     FROM migration_acceptance.expected_timezone_values
     EXCEPT
     SELECT
       id,
       CASE
         WHEN timezone IS NULL THEN NULL
         ELSE pg_catalog.convert_to(timezone, 'UTF8')
       END
     FROM public.leagues)
    UNION ALL
    (SELECT
       id,
       CASE
         WHEN timezone IS NULL THEN NULL
         ELSE pg_catalog.convert_to(timezone, 'UTF8')
       END
     FROM public.leagues
     EXCEPT
     SELECT id, timezone_bytes
     FROM migration_acceptance.expected_timezone_values)
  ) THEN
    RAISE EXCEPTION 'failed NULL-baseline migration left partial data effects';
  END IF;

  IF EXISTS (
    (SELECT * FROM migration_acceptance.expected_timezone_catalog
     EXCEPT
     SELECT
       attribute.attnotnull,
       attribute.atttypid,
       attribute.atttypmod,
       attribute.attlen,
       attribute.attbyval,
       attribute.attalign,
       attribute.attstorage,
       attribute.attidentity,
       attribute.attgenerated,
       attribute.atthasdef,
       pg_catalog.convert_to(defaults.adbin::text, 'UTF8'),
       pg_catalog.convert_to(
         pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
         'UTF8'
       )
     FROM pg_catalog.pg_attribute AS attribute
     LEFT JOIN pg_catalog.pg_attrdef AS defaults
       ON defaults.adrelid = attribute.attrelid
      AND defaults.adnum = attribute.attnum
     WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
       AND attribute.attname = 'timezone'
       AND NOT attribute.attisdropped)
    UNION ALL
    (SELECT
       attribute.attnotnull,
       attribute.atttypid,
       attribute.atttypmod,
       attribute.attlen,
       attribute.attbyval,
       attribute.attalign,
       attribute.attstorage,
       attribute.attidentity,
       attribute.attgenerated,
       attribute.atthasdef,
       pg_catalog.convert_to(defaults.adbin::text, 'UTF8'),
       pg_catalog.convert_to(
         pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
         'UTF8'
       )
     FROM pg_catalog.pg_attribute AS attribute
     LEFT JOIN pg_catalog.pg_attrdef AS defaults
       ON defaults.adrelid = attribute.attrelid
      AND defaults.adnum = attribute.attnum
     WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
       AND attribute.attname = 'timezone'
       AND NOT attribute.attisdropped
     EXCEPT
     SELECT * FROM migration_acceptance.expected_timezone_catalog)
  ) THEN
    RAISE EXCEPTION 'failed NULL-baseline migration left partial schema/default effects';
  END IF;
END;
$null_rejection$;

SELECT 'leagues timezone NULL-baseline atomic rejection acceptance passed' AS result;
