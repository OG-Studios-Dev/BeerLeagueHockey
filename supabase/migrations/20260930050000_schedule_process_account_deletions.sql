BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.invoke_process_account_deletions()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cron_secret text;
  secret_count bigint;
  request_id bigint;
BEGIN
  SELECT count(*), min(NULLIF(btrim(secret.decrypted_secret), ''))
  INTO secret_count, cron_secret
  FROM vault.decrypted_secrets AS secret
  WHERE secret.name = 'account_deletion_cron_secret';

  IF secret_count = 0 THEN
    RAISE EXCEPTION 'Vault secret account_deletion_cron_secret is missing or blank.';
  END IF;

  IF secret_count > 1 THEN
    RAISE EXCEPTION 'Vault secret account_deletion_cron_secret is ambiguous.';
  END IF;

  IF cron_secret IS NULL THEN
    RAISE EXCEPTION 'Vault secret account_deletion_cron_secret is missing or blank.';
  END IF;

  SELECT net.http_post(
    url := 'https://ntplczcmhvfkijjxavdl.supabase.co/functions/v1/process-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', cron_secret
    ),
    body := jsonb_build_object('mode', 'batch')
  )
  INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_process_account_deletions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_process_account_deletions() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_process_account_deletions() FROM authenticated;

DO $$
DECLARE
  existing_job_id bigint;
BEGIN
  FOR existing_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'process-account-deletions'
  LOOP
    PERFORM cron.unschedule(existing_job_id);
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'process-account-deletions',
  '*/5 * * * *',
  $cron$
  SELECT public.invoke_process_account_deletions();
  $cron$
);

COMMIT;
