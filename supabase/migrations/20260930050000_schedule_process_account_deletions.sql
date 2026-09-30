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
  service_role_key text;
  request_id bigint;
BEGIN
  SELECT NULLIF(btrim(secret.decrypted_secret), '')
  INTO service_role_key
  FROM vault.decrypted_secrets AS secret
  WHERE secret.name = 'service_role_key'
  LIMIT 1;

  IF service_role_key IS NULL THEN
    RAISE EXCEPTION 'Vault secret service_role_key is missing or blank.';
  END IF;

  SELECT net.http_post(
    url := 'https://ntplczcmhvfkijjxavdl.supabase.co/functions/v1/process-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
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
