\set ON_ERROR_STOP on

CREATE SCHEMA migration_acceptance;
CREATE TABLE public.leagues (
  id uuid PRIMARY KEY,
  timezone text DEFAULT 'America/Toronto'::text
);

INSERT INTO public.leagues(id, timezone) VALUES
  ('30000000-0000-4000-8000-000000000001', 'UTC'),
  ('30000000-0000-4000-8000-000000000002', NULL),
  ('30000000-0000-4000-8000-000000000003', E'  Etc/GMT+5\n'),
  ('30000000-0000-4000-8000-000000000004', U&'Am\00E9rica/St_Johns');

CREATE TABLE migration_acceptance.expected_timezone_values AS
SELECT
  id,
  CASE
    WHEN timezone IS NULL THEN NULL
    ELSE pg_catalog.convert_to(timezone, 'UTF8')
  END AS timezone_bytes
FROM public.leagues;

CREATE TABLE migration_acceptance.expected_timezone_catalog AS
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
  pg_catalog.convert_to(defaults.adbin::text, 'UTF8') AS adbin_bytes,
  pg_catalog.convert_to(
    pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid),
    'UTF8'
  ) AS expression_bytes
FROM pg_catalog.pg_attribute AS attribute
LEFT JOIN pg_catalog.pg_attrdef AS defaults
  ON defaults.adrelid = attribute.attrelid
 AND defaults.adnum = attribute.attnum
WHERE attribute.attrelid = 'public.leagues'::pg_catalog.regclass
  AND attribute.attname = 'timezone'
  AND NOT attribute.attisdropped;
