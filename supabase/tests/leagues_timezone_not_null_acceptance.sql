\set ON_ERROR_STOP on

-- Production-shaped baseline: nullable text column, existing default, zero NULL rows.
CREATE TABLE public.leagues (
  id uuid PRIMARY KEY,
  timezone text DEFAULT 'America/Toronto'::text
);

INSERT INTO public.leagues(id, timezone) VALUES
  ('10000000-0000-4000-8000-000000000001', 'UTC'),
  ('10000000-0000-4000-8000-000000000002', '  America/Toronto  '),
  ('10000000-0000-4000-8000-000000000003', E'Etc/GMT+5\n'),
  ('10000000-0000-4000-8000-000000000004', U&'Am\00E9rica/St_Johns');

CREATE TEMP TABLE expected_timezone_values AS
SELECT id, pg_catalog.convert_to(timezone, 'UTF8') AS timezone_bytes
FROM public.leagues;

CREATE TEMP TABLE expected_timezone_default AS
SELECT
  pg_catalog.convert_to(defaults.adbin::text, 'UTF8') AS adbin_bytes,
  pg_catalog.convert_to(
    pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
    'UTF8'
  ) AS expression_bytes
FROM pg_catalog.pg_attribute AS attribute
JOIN pg_catalog.pg_attrdef AS defaults
  ON defaults.adrelid = attribute.attrelid
 AND defaults.adnum = attribute.attnum
WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
  AND attribute.attname = 'timezone'
  AND NOT attribute.attisdropped;

DO $nullable_baseline$
BEGIN
  IF (SELECT attribute.attnotnull
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
        AND attribute.attname = 'timezone'
        AND NOT attribute.attisdropped) THEN
    RAISE EXCEPTION 'fixture timezone unexpectedly starts NOT NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM public.leagues WHERE timezone IS NULL) THEN
    RAISE EXCEPTION 'fixture unexpectedly contains a NULL timezone';
  END IF;
END;
$nullable_baseline$;

\ir ../migrations/20261016010000_leagues_timezone_not_null.sql

DO $nullable_repaired$
BEGIN
  IF NOT (SELECT attribute.attnotnull
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
            AND attribute.attname = 'timezone'
            AND NOT attribute.attisdropped) THEN
    RAISE EXCEPTION 'nullable zero-NULL timezone baseline was not repaired';
  END IF;

  IF EXISTS (
    (SELECT id, timezone_bytes FROM expected_timezone_values
     EXCEPT
     SELECT id, pg_catalog.convert_to(timezone, 'UTF8') FROM public.leagues)
    UNION ALL
    (SELECT id, pg_catalog.convert_to(timezone, 'UTF8') FROM public.leagues
     EXCEPT
     SELECT id, timezone_bytes FROM expected_timezone_values)
  ) THEN
    RAISE EXCEPTION 'timezone values changed byte-for-byte during repair';
  END IF;

  IF EXISTS (
    (SELECT adbin_bytes, expression_bytes FROM expected_timezone_default
     EXCEPT
     SELECT
       pg_catalog.convert_to(defaults.adbin::text, 'UTF8'),
       pg_catalog.convert_to(
         pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
         'UTF8'
       )
     FROM pg_catalog.pg_attribute AS attribute
     JOIN pg_catalog.pg_attrdef AS defaults
       ON defaults.adrelid = attribute.attrelid
      AND defaults.adnum = attribute.attnum
     WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
       AND attribute.attname = 'timezone'
       AND NOT attribute.attisdropped)
    UNION ALL
    (SELECT
       pg_catalog.convert_to(defaults.adbin::text, 'UTF8'),
       pg_catalog.convert_to(
         pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
         'UTF8'
       )
     FROM pg_catalog.pg_attribute AS attribute
     JOIN pg_catalog.pg_attrdef AS defaults
       ON defaults.adrelid = attribute.attrelid
      AND defaults.adnum = attribute.attnum
     WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
       AND attribute.attname = 'timezone'
       AND NOT attribute.attisdropped
     EXCEPT
     SELECT adbin_bytes, expression_bytes FROM expected_timezone_default)
  ) THEN
    RAISE EXCEPTION 'timezone default changed byte-for-byte during repair';
  END IF;
END;
$nullable_repaired$;

SELECT 'leagues timezone nullable zero-NULL repair and byte-preservation acceptance passed' AS result;

-- Independent already-NOT-NULL baseline, followed by a second application to prove
-- the migration remains safe when replayed by a disposable compatibility harness.
DROP TABLE public.leagues;
TRUNCATE expected_timezone_values, expected_timezone_default;

CREATE TABLE public.leagues (
  id uuid PRIMARY KEY,
  timezone text NOT NULL DEFAULT 'America/Toronto'::text
);

INSERT INTO public.leagues(id, timezone) VALUES
  ('20000000-0000-4000-8000-000000000001', 'UTC'),
  ('20000000-0000-4000-8000-000000000002', E'Pacific/Honolulu\t');

INSERT INTO expected_timezone_values
SELECT id, pg_catalog.convert_to(timezone, 'UTF8')
FROM public.leagues;

INSERT INTO expected_timezone_default
SELECT
  pg_catalog.convert_to(defaults.adbin::text, 'UTF8'),
  pg_catalog.convert_to(
    pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
    'UTF8'
  )
FROM pg_catalog.pg_attribute AS attribute
JOIN pg_catalog.pg_attrdef AS defaults
  ON defaults.adrelid = attribute.attrelid
 AND defaults.adnum = attribute.attnum
WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
  AND attribute.attname = 'timezone'
  AND NOT attribute.attisdropped;

\ir ../migrations/20261016010000_leagues_timezone_not_null.sql
\ir ../migrations/20261016010000_leagues_timezone_not_null.sql

DO $already_not_null$
BEGIN
  IF NOT (SELECT attribute.attnotnull
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
            AND attribute.attname = 'timezone'
            AND NOT attribute.attisdropped) THEN
    RAISE EXCEPTION 'already-NOT-NULL timezone became nullable';
  END IF;

  IF EXISTS (
    (SELECT id, timezone_bytes FROM expected_timezone_values
     EXCEPT
     SELECT id, pg_catalog.convert_to(timezone, 'UTF8') FROM public.leagues)
    UNION ALL
    (SELECT id, pg_catalog.convert_to(timezone, 'UTF8') FROM public.leagues
     EXCEPT
     SELECT id, timezone_bytes FROM expected_timezone_values)
  ) THEN
    RAISE EXCEPTION 'already-NOT-NULL timezone values changed byte-for-byte';
  END IF;

  IF EXISTS (
    (SELECT adbin_bytes, expression_bytes FROM expected_timezone_default
     EXCEPT
     SELECT
       pg_catalog.convert_to(defaults.adbin::text, 'UTF8'),
       pg_catalog.convert_to(
         pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
         'UTF8'
       )
     FROM pg_catalog.pg_attribute AS attribute
     JOIN pg_catalog.pg_attrdef AS defaults
       ON defaults.adrelid = attribute.attrelid
      AND defaults.adnum = attribute.attnum
     WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
       AND attribute.attname = 'timezone'
       AND NOT attribute.attisdropped)
    UNION ALL
    (SELECT
       pg_catalog.convert_to(defaults.adbin::text, 'UTF8'),
       pg_catalog.convert_to(
         pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
         'UTF8'
       )
     FROM pg_catalog.pg_attribute AS attribute
     JOIN pg_catalog.pg_attrdef AS defaults
       ON defaults.adrelid = attribute.attrelid
      AND defaults.adnum = attribute.attnum
     WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
       AND attribute.attname = 'timezone'
       AND NOT attribute.attisdropped
     EXCEPT
     SELECT adbin_bytes, expression_bytes FROM expected_timezone_default)
  ) THEN
    RAISE EXCEPTION 'already-NOT-NULL timezone default changed byte-for-byte';
  END IF;
END;
$already_not_null$;

SELECT 'leagues timezone already-NOT-NULL replay compatibility acceptance passed' AS result;
