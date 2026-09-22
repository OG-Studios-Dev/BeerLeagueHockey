# Account deletion post-apply live test matrix

This is a release verification plan for migrations
`20260921160000_harden_account_deletion.sql`,
`20260921170000_complete_account_lifecycle_cleanup.sql`, and
`20260922120000_account_deletion_review_corrections.sql`, plus the deployed
`delete-account` Edge Function. It is not permission to deploy or to use a real
account. All successful-deletion cases require dedicated disposable fixtures.

## Preconditions

1. Record the approved project, source commit, both applied migration versions,
   and SHA-256 hashes of the reviewed migrations and Edge Function bundle.
2. Confirm the expected tables and columns exist. In particular, verify
   `profiles.push_token`, `team_rosters.historical_retained`,
   `sub_invitations.replaced_player_id`, and `game_checkins.note`. The migration
   must reject an optional historical table with an incompatible relation kind
   or missing `user_id` column before any storage operation.
3. Create separate disposable email, Google, Apple, organization-owner,
   league-owner, and
   atomic-rollback fixtures. Do not reuse a human account.
   The immediate Edge Function fixture must start with zero processing deletion-log rows;
   the processor fixture must start with exactly one.
4. Seed each applicable fixture with rows for `user_consents`,
   `league_memberships`, `team_rosters`, `notifications`,
   `push_subscriptions`, `user_notification_preferences`, `team_messages`,
   `user_sessions`, authored/received `sub_invitations`, authored
   `goalie_requests`, authored `goalie_ratings`, and `game_checkins` with a
   synthetic note.
5. Seed `profiles.push_token`; if `push_device_tokens` exists, seed a token
   there too. Save exact before snapshots.
6. Upload disposable image fixtures using each repository-proven contract:
   `avatars/{user_id}/avatar.jpg`,
   `player-avatars/{user_id}-{timestamp}.{jpg|jpeg|png|webp}`, and
   `player-photos/{user_id}/{timestamp}.{jpg|jpeg|png|webp}`. Store the public
   URLs only in that fixture's `avatar_url`/`photo_url`.
7. Create synthetic historical game, event, stat, badge, and attendance
   sentinels and save deterministic hashes. These are not real player records.

## Matrix

| ID | Caller and action | Required result |
|---|---|---|
| **LIVE-01** | Read migration history, `pg_proc`, `pg_namespace`, profile/auth FK, and exact function definitions after apply. | All three corrective versions are applied once. Privileged deletion helpers are `SECURITY DEFINER`, owned by `postgres`, with empty `search_path`. The auth cascade is absent and the active-profile deferred invariant exists; a deleted historical profile survives auth deletion. |
| **LIVE-02** | Check effective and catalog EXECUTE privileges for every deletion helper, including an unknown test grantee and default ACLs. | `service_role` is allowed to call privileged helpers. Only `authenticated` can call the no-argument logout RPC. `anon`, unexpected roles, and authenticated direct deletion calls are denied. |
| **LIVE-03** | Invoke the deployed Edge Function as the organization-owner and league-owner fixtures; try assigning each ownership path after deletion state starts. | HTTP 409 with the applicable ownership code. No storage/auth/DB mutation occurs, and reassignment is rejected until deletion completes. |
| **LIVE-04** | Invoke the deployed Edge Function as the non-Apple, non-owner fixture with `{ "confirmation": "DELETE" }`. | HTTP 200. All fixed-prefix owned image pages are absent. Auth is absent. Operational/PII rows follow the retention matrix; roster-only and stat-backed completed-game history remain, inactive and non-authorizing. External state is pending until Stripe and email complete. |
| **LIVE-04B** | Run the scheduled processor with forced first-attempt Stripe failure and then forced first-attempt email failure. Retry each. | No early overall completion. Stripe retry does not repeat database deletion; email retry does not repeat Stripe. Each retry payload is erased only after its step succeeds, then the deletion log completes. |
| **LIVE-05** | In isolated staging, add a test-only `NO ACTION` auth blocker and invoke the RPC. Remove the blocker afterward. | RPC failure causes atomic rollback of every DB delete/anonymization, including push and authored rows. Historical sentinels are unchanged. Storage is an external pre-step and is not transactionally restored; verify and document that separately. |
| **LIVE-06** | In isolated staging with disposable compatible `audit_logs` and `stripe_payment_history` tables, invoke the retention helpers as each API role. | Service role minimizes network/provider identifiers. Metadata JSON is intentionally discarded; typed payment facts remain and are not called anonymous. Client roles are denied. The absent-table case returns zero. |
| **LIVE-07** | Log in as account A, register a disposable push token, log out, then log in as account B on the same device. Repeat for zero rows, RLS denial, missing/stale session, and post-deletion sign-out failure. | The authenticated RPC derives account A from `auth.uid()` and proves exactly one cleanup before normal sign-out. Every failure is fail-closed. Post-deletion local failure purges local credentials/state. Account B never inherits account A's destination. |
| **LIVE-08** | Delete a fixture with pending and accepted invitations, open and filled goalie requests, a rating/private note, and a check-in note. | Non-accepted invitations and non-filled requests are absent. Accepted substitutions, filled-request status/payment facts, rating score/tags, and check-in status remain, but their message/notes/compensation/private-note text is null. All request-notification tokens are absent. Games, events, stats, badges, and other users' rows are unchanged. |
| **LIVE-09** | Upload every accepted MIME type with weird/missing/traversal filename extensions. Delete fixtures spanning multiple list pages, missing objects, legacy/current paths, foreign names, and a forced partial remove failure. | This is the storage allowlist case. Upload extensions come only from validated MIME. Server-fixed buckets/prefixes are listed with bounded pagination. Foreign/traversal input never reaches remove. Missing objects proceed; partial failure stops before DB/auth deletion. |
| **LIVE-10** | Invoke deletion for an Apple-linked fixture with a fresh code, then force DB failure after revocation and retry without a code. Also submit an exact-email and unrelated/shared-email contact form. | Apple revocation is blocked if exchange/revocation cannot be established; provider failure changes nothing. On success, durable marker permits the DB retry and no second provider grant. `contact_submissions` has no authenticated-user key, so only an exact normalized account-email match is deleted; unrelated submissions remain. |
| **LIVE-11** | Seed the retention matrix, including security logs, paid/unpaid registrations, signed waiver, payment/provider metadata, completed/future availability, roster-only completed games, and stat-backed completed games. | Every field matches its delete/clear/retain classification. Waiver and financial records are reported as legally retained, not anonymous. Historical jersey/position/appearance/stat results remain reproducible. |

## ACL query shape

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
    ('public.delete_push_device_tokens(uuid)'),
    ('public.execute_account_deletion(uuid)')
) AS f(signature)
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY f.signature, r.rolname;
```

## Stop conditions

Stop rollout if any unexpected role can execute a privileged helper, a required
column/relation shape is incompatible, an organization owner loses an image,
arbitrary storage paths reach `remove`, Apple deletion continues without proven
revocation, auth disappears while required DB cleanup failed, external failure
is marked complete, or a historical sentinel changes. Do not repair a live
mismatch by editing an applied migration.
