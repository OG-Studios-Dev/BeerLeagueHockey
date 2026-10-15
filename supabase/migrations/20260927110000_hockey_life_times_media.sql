BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Newspaper drafts/cache never use the inherited public, authenticated-writable
-- news-images bucket. The private bucket also holds small HMAC-bound JSON
-- provenance; the adapter enforces its 64 KiB metadata limit before parsing.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'newspaper-media-private',
  'newspaper-media-private',
  false,
  16777216,
  ARRAY['image/png', 'application/json']
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Only immutable, content-addressed PNGs are promoted here by the authorized
-- Publish action. Public means readable after promotion, never client-writable.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'newspaper-media-public',
  'newspaper-media-public',
  true,
  16777216,
  ARRAY['image/png']
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Newspaper private media is never client readable" ON storage.objects;
DROP POLICY IF EXISTS "Newspaper media is never client insertable" ON storage.objects;
DROP POLICY IF EXISTS "Newspaper media is never client updateable" ON storage.objects;
DROP POLICY IF EXISTS "Newspaper media is never client deletable" ON storage.objects;
DROP POLICY IF EXISTS "Service role manages newspaper private media" ON storage.objects;
DROP POLICY IF EXISTS "Service role manages newspaper public media" ON storage.objects;

-- Restrictive policies remain an AND-gate even if another permissive storage
-- policy is later broadened. The old news-images policies therefore cannot OR
-- around these new bucket boundaries.
CREATE POLICY "Newspaper private media is never client readable"
  ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (bucket_id <> 'newspaper-media-private');

CREATE POLICY "Newspaper media is never client insertable"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id NOT IN ('newspaper-media-private', 'newspaper-media-public'));

CREATE POLICY "Newspaper media is never client updateable"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id NOT IN ('newspaper-media-private', 'newspaper-media-public'))
  WITH CHECK (bucket_id NOT IN ('newspaper-media-private', 'newspaper-media-public'));

CREATE POLICY "Newspaper media is never client deletable"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (bucket_id NOT IN ('newspaper-media-private', 'newspaper-media-public'));

CREATE POLICY "Service role manages newspaper private media"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'newspaper-media-private')
  WITH CHECK (bucket_id = 'newspaper-media-private');

CREATE POLICY "Service role manages newspaper public media"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'newspaper-media-public')
  WITH CHECK (bucket_id = 'newspaper-media-public');

COMMIT;
