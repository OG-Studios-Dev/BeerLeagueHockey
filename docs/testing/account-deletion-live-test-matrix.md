# Account deletion post-apply live test matrix

This matrix is the required verification plan for migration
`20260921160000_harden_account_deletion.sql`. It is not permission to deploy the
migration. Use only dedicated disposable users and the approved project. Never
run the successful-deletion case against a real account.

## Fixed preconditions

1. Record the approved project ref, current source commit, applied migration
   version, and SHA-256 of the reviewed migration file.
2. Confirm `public.audit_logs` and `public.stripe_payment_history` are absent in
   production, while `public.profiles`, `public.organizations`,
   `public.account_deletion_log`, and every explicitly deleted account-facing
   table are present.
3. Create three disposable users through Supabase Auth: a non-owner Edge
   Function fixture with zero processing deletion-log rows, a non-owner
   processor fixture with one processing deletion-log row, and an
   organization-owner rejection fixture. Do not reuse a human account.
4. For each non-owner fixture, create one row in each of these exact paths:
   `user_consents.user_id`, `league_memberships.user_id`,
   `team_rosters.player_id`, `notifications.user_id`,
   `push_subscriptions.user_id`, `user_notification_preferences.user_id`,
   `team_messages.sent_by`, and `user_sessions.user_id`.
5. Populate every profile PII/security field covered by the migration. Also set
   hockey fields such as position, jersey number, shot hand, and skill level.
6. Create or attach synthetic historical game/stat sentinel rows through normal
   application fixtures. Save their primary keys and a deterministic before
   snapshot/hash. These sentinels must not be real player history.
7. Save before counts and row snapshots for both disposable users. A failed
   case is not cleanup; compare exact rows after each call.

## Matrix

| ID | Environment and caller | Action | Required result |
|---|---|---|---|
| **LIVE-01** | Approved production, read-only SQL | Read `pg_proc`, `pg_namespace`, `pg_roles`, migration history, and the exact FK from `public.profiles.id` to `auth.users.id` after apply. | Version `20260921160000` is applied once; all four function definitions have `prosecdef = true` and an empty configured `search_path`; `audit_logs` and `stripe_payment_history` remain absent; no FK definition changed; deleting `auth.users` must not delete the retained profile. Stop if that final FK precondition is false. |
| **LIVE-02** | Approved production, role matrix | Evaluate `has_function_privilege` for `anon`, `authenticated`, and `service_role` against `anonymize_audit_logs(uuid)`, `anonymize_payment_history(uuid,text)`, `delete_user_sessions(uuid)`, and `execute_account_deletion(uuid)`. Also attempt the master RPC with disposable fixtures. | `anon` denied, `authenticated` denied, and `service_role` allowed for every signature. Direct anon/authenticated RPC calls fail with permission denied and make zero row changes. Service role reaches business logic. |
| **LIVE-03** | Approved production, authenticated owner fixture through the deployed `delete-account` Edge Function | POST `{ "confirmation": "DELETE" }` using the owner fixture's bearer token. | HTTP 409 `organization_ownership`; auth user, profile, organization, all account-facing rows, historical sentinels, and profile PII are byte-for-byte unchanged. This proves owner rejection happens before mutation. |
| **LIVE-04** | Approved production, authenticated non-owner Edge fixture through the deployed `delete-account` Edge Function; optional `audit_logs` and `stripe_payment_history` absent; zero processing deletion-log rows | POST `{ "confirmation": "DELETE" }` once. | HTTP 200; no deletion-log row is required or synthesized; all eight explicit account-facing row sets are empty; `auth.users` has no fixture row; the retained profile exists with all listed PII cleared/anonymized and all admin/security state removed; hockey fields and every historical sentinel are unchanged. A second authenticated call is impossible because Auth is gone. |
| **LIVE-04B** | Approved production, processor fixture with one processing deletion-log row, direct service-role RPC through the existing processor path | Execute the master RPC once and record its JSON result. | Success result reports `audit_logs_anonymized = 0`, `payment_history_anonymized = 0`, and `deletion_logs_completed = 1`; the processing log is completed; all LIVE-04 deletion, profile, auth, and historical assertions also hold. |
| **LIVE-05** | Isolated approved staging database, direct service-role RPC | Before the call, add a test-only `NO ACTION` blocker that references the fixture's `auth.users.id`, then invoke the master RPC so failure occurs at the auth deletion step. Remove the blocker after verification. | RPC fails on the blocker; atomic rollback restores optional retention rows, all eight account-facing row sets, the original profile PII/security fields, auth user, deletion-log state, and historical sentinels exactly. No partial delete or anonymization remains. |
| **LIVE-06** | Isolated approved staging database with disposable compatible `public.audit_logs` and `public.stripe_payment_history` tables | Seed one matching row in each optional table, execute the two helpers as `service_role`, and repeat privilege attempts as `anon` and `authenticated`. | Service role receives count `1` from each helper; direct PII in audit details/IP/user-agent and Stripe customer metadata is removed; metadata JSON is intentionally discarded rather than retained; typed action, amount, currency, and date columns remain unchanged; anon/authenticated are denied; dropping the disposable optional tables returns the environment to its prior shape. |

## Exact ACL query shape

Run this as a read-only verification query after apply and require the expected
booleans from LIVE-02:

```sql
SELECT
  r.rolname,
  f.signature,
  pg_catalog.has_function_privilege(r.rolname, f.signature, 'EXECUTE') AS can_execute
FROM pg_catalog.pg_roles AS r
CROSS JOIN (
  VALUES
    ('public.anonymize_audit_logs(uuid)'),
    ('public.anonymize_payment_history(uuid,text)'),
    ('public.delete_user_sessions(uuid)'),
    ('public.execute_account_deletion(uuid)')
) AS f(signature)
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY f.signature, r.rolname;
```

Expected for each signature: `anon = false`, `authenticated = false`,
`service_role = true`.

## Stop conditions

Stop and roll back the release if any function is executable by an API client
role other than `service_role`, any required production table/column is absent,
auth deletion removes the retained profile, any historical snapshot changes,
or LIVE-04 leaves any explicit account-facing rows. Do not repair FK behavior
inside this migration and do not broaden deletion by discovering FK targets at
runtime.
