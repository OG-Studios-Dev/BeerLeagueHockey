# Account deletion post-apply live test matrix

This is a release verification plan for migrations
`20260921160000_harden_account_deletion.sql` and
`20260921170000_complete_account_lifecycle_cleanup.sql`, plus the deployed
`delete-account` Edge Function. It is not permission to deploy or to use a real
account. All successful-deletion cases require dedicated disposable fixtures.

## Preconditions

1. Record the approved project, source commit, both applied migration versions,
   and SHA-256 hashes of the reviewed migrations and Edge Function bundle.
2. Confirm the expected tables and columns exist. In particular, verify
   `profiles.push_token`, `sub_invitations.replaced_player_id`, and
   `game_checkins.note`. Record whether the known optional tables
   `audit_logs`, `stripe_payment_history`, and `push_device_tokens` exist.
3. Create separate disposable email, Google, Apple, organization-owner, and
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
| **LIVE-01** | Read migration history, `pg_proc`, `pg_namespace`, profile/auth FK, and exact function definitions after apply. | Both corrective versions are applied once. Every deletion helper is `SECURITY DEFINER` with empty `search_path`. No profile/auth FK or hockey-table FK was changed. The retained profile survives auth deletion. |
| **LIVE-02** | Check `has_function_privilege` for `anon`, `authenticated`, and `service_role` on `anonymize_audit_logs(uuid)`, `anonymize_payment_history(uuid,text)`, `delete_user_sessions(uuid)`, `delete_push_device_tokens(uuid)`, and `execute_account_deletion(uuid)`. | `anon` and `authenticated` are denied; `service_role` is allowed. Direct client-role RPC attempts make zero changes. |
| **LIVE-03** | Invoke the deployed Edge Function as the organization-owner fixture. | HTTP 409 `organization_ownership`. No storage object, auth row, profile field, account-facing row, or historical sentinel changes. |
| **LIVE-04** | Invoke the deployed Edge Function as the non-Apple, non-owner fixture with `{ "confirmation": "DELETE" }`. | HTTP 200. Allowlisted profile images are absent. Auth is absent. Account-facing rows are deleted, profile and retained deletion-log identifiers are anonymized, all push destinations are cleared, and historical hashes are unchanged. Local app sign-out succeeds without a redundant profile write. |
| **LIVE-04B** | Invoke `execute_account_deletion` through the legacy scheduled processor fixture with one `processing` deletion-log row. | DB cleanup is atomic and the log completes with direct identifiers removed. This DB-only processor does not prove profile-image cleanup or Apple revocation; do not count it as iOS in-app deletion acceptance. |
| **LIVE-05** | In isolated staging, add a test-only `NO ACTION` auth blocker and invoke the RPC. Remove the blocker afterward. | RPC failure causes atomic rollback of every DB delete/anonymization, including push and authored rows. Historical sentinels are unchanged. Storage is an external pre-step and is not transactionally restored; verify and document that separately. |
| **LIVE-06** | In isolated staging with disposable compatible `audit_logs` and `stripe_payment_history` tables, invoke the retention helpers as each API role. | Service role anonymizes direct identifiers. Metadata JSON is intentionally discarded; typed payment facts remain. Client roles are denied. The absent-table case returns zero. |
| **LIVE-07** | Log in as account A, register a disposable push token, log out, then log in as account B on the same device. Repeat with a forced profile-update failure. | Successful logout clears account A's `profiles.push_token` before local sign-out; account B is the only normal-path owner after registration. On cleanup failure, logout stops and shows safe feedback without exposing backend detail. Account deletion also clears `profiles.push_token`, `push_subscriptions`, and optional `push_device_tokens`. |
| **LIVE-08** | Delete a fixture with pending and accepted invitations, open and filled goalie requests, a rating/private note, and a check-in note. | Non-accepted invitations and non-filled requests are absent. Accepted substitutions, filled-request status/payment facts, rating score/tags, and check-in status remain, but their message/notes/compensation/private-note text is null. All request-notification tokens are absent. Games, events, stats, badges, and other users' rows are unchanged. |
| **LIVE-09** | Exercise every allowlisted image URL, an absent image, an already-missing object, a foreign-user path, an arbitrary bucket, encoded traversal, and a forced storage error. | Proven owned objects are removed before the RPC. Absent/already-missing objects proceed. Non-allowlisted input is never sent to Storage. A real removal error returns `image_cleanup_failed` and auth/DB deletion does not run. This is the storage deletion allowlist acceptance case. |
| **LIVE-10** | Invoke deletion for an Apple-linked fixture, then submit a contact form as both guest and signed-in user. | Apple revocation is blocked with `apple_revocation_unavailable` before storage/DB mutation. `contact_submissions` has no authenticated-user key, so neither submission is automatically attributed or deleted by account UUID; verify the privacy text gives a manual request path and does not claim automatic erasure. |

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

Stop rollout if any client role can execute a privileged helper, an expected
column is absent, an organization owner loses an image, arbitrary storage paths
reach `remove`, Apple-linked deletion reports success, auth disappears while a
required DB cleanup failed, or any historical sentinel changes. Do not repair a
live mismatch by editing an applied migration.
