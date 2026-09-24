# Account deletion post-apply live test matrix

This is a release verification plan for migrations
`20260921160000_harden_account_deletion.sql`,
`20260921170000_complete_account_lifecycle_cleanup.sql`, and
`20260922120000_account_deletion_review_corrections.sql`, and
`20260922170000_account_deletion_correction_pass_2.sql`, and
`20260923120000_account_deletion_correction_pass_3.sql`, and
`20260923130000_immediate_account_deletion_v1.sql`, and
`20260923140000_account_deletion_apple_identity_fail_closed.sql`, plus the deployed
`delete-account` Edge Function. It is not permission to deploy or to use a real
account. All successful-deletion cases require dedicated disposable fixtures.

## Preconditions

1. Record the approved project, source commit, all seven applied migration versions,
   and SHA-256 hashes of the reviewed migrations and Edge Function bundle.
2. Confirm the expected tables and columns exist. In particular, verify
   `profiles.push_token`, `team_rosters.historical_retained`,
   `sub_invitations.replaced_player_id`, and `game_checkins.note`. The migration
   must reject an optional historical table with an incompatible relation kind,
   column type/nullability, or primary key before any storage operation.
3. Create separate disposable email, Google, Apple, organization-owner,
   league-owner, and
   atomic-rollback fixtures. Do not reuse a human account.
   The immediate Edge Function fixture must start with zero processing deletion-log rows;
   the processor fixture must start with one `immediate`/`database_deleted` state.
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
| **LIVE-01** | Read migration history, `pg_proc`, `pg_namespace`, profile/auth FK, and exact function definitions after apply. | All seven listed migration versions are applied once. Every entrypoint and transitive helper is `SECURITY DEFINER`, owned by `postgres`, with empty `search_path`. The auth cascade is absent and the active-profile deferred invariant exists; a deleted historical profile survives auth deletion. |
| **LIVE-02** | Check effective and catalog EXECUTE privileges for every deletion helper, including an unknown test grantee and default ACLs. | `service_role` is allowed to call privileged helpers. Only `authenticated` can call the no-argument logout RPC. `anon`, unexpected roles, and authenticated direct deletion calls are denied. |
| **LIVE-03** | Invoke the deployed Edge Function as the organization-owner and league-owner fixtures. Run `scripts/tests/account-deletion-ownership-race.ts` against disposable loopback PostgreSQL so preflight holds session A while session B assigns authority; repeat for organization ownership, league `owner_id`/`created_by`, organization membership, explicit `league_ownerships`, and `league_memberships` owner/admin insert, reassignment, and promotion. | HTTP 409 with the applicable ownership code. Session B blocks on the same per-user advisory lock and then fails after session A inserts deletion state. Assignments/promotions to deleted/authless profiles also fail. No external side effect begins while reassignment can still commit. |
| **LIVE-04** | Invoke the deployed Edge Function as the non-Apple, non-owner fixture with `{ "confirmation": "DELETE" }`. | HTTP 200. All fixed-prefix owned image pages are absent. Auth is absent. Operational/PII rows follow the retention matrix; roster-only and stat-backed completed-game history remain, inactive and non-authorizing. External state is pending until Stripe and email complete. |
| **LIVE-04B** | Run the retry processor with forced first-attempt Stripe failure and then forced first-attempt email failure. Retry each. | The processor selects only `immediate`/`database_deleted` state and never invokes storage or database deletion. Stripe retry does not repeat database deletion; email retry does not repeat Stripe. Each retry payload is erased only after its step succeeds. Any failed item or retry-marker failure returns non-200. |
| **LIVE-05** | In isolated staging, add a test-only `NO ACTION` auth blocker and invoke the RPC. Remove the blocker afterward. | RPC failure causes atomic rollback of every DB delete/anonymization, including push and authored rows. Historical sentinels are unchanged. Storage is an external pre-step and is not transactionally restored; verify and document that separately. |
| **LIVE-06** | In isolated staging with disposable compatible `audit_logs` and `stripe_payment_history` tables, invoke the retention helpers as each API role. | Service role minimizes network/provider identifiers. Metadata JSON is intentionally discarded; typed payment facts remain and are not called anonymous. Client roles are denied. The absent-table case returns zero. |
| **LIVE-07** | Log in as account A, register a disposable push token, log out, then log in as account B on the same device. Repeat for zero rows, RLS denial, missing/stale session, and post-deletion sign-out failure. | The authenticated RPC derives account A from `auth.uid()` and proves exactly one cleanup before normal sign-out. Every failure is fail-closed. Post-deletion local failure purges local credentials/state. Account B never inherits account A's destination. |
| **LIVE-08** | Run `supabase/tests/account_deletion_operational_authority_acceptance.sql`, then delete a fixture with completed and future check-ins/availability/substitutions, captain invites, spare/draft pools, opt-ins, duties, duty rotations, scorekeeper assignments/swaps, organization/league access rows, team invitations, paid pending registration, active suspension, roster rows, and lineup JSON. | The anonymized UUID is absent from every open/future selection or authorization query. Spare rows are inactive, retained paid/waiver registrations are cancelled and unassigned, and non-terminal suspensions are absent. Only completed-game check-in/availability/substitution/duty/assignment and roster facts remain under their explicit predicates, with free text minimized. |
| **LIVE-09** | Upload every accepted MIME type with weird/missing/traversal filename extensions. Delete fixtures spanning multiple list pages, missing objects, legacy/current paths, foreign names, and a forced partial remove failure. | This is the storage allowlist case. Upload extensions come only from validated MIME. Server-fixed buckets/prefixes are listed with bounded pagination. Foreign/traversal input never reaches remove. Missing objects proceed; partial failure stops before DB/auth deletion. |
| **LIVE-10** | Invoke deletion for an Apple-linked fixture with a fresh code belonging to that identity; repeat with a valid code for another Apple identity. Force (a) network failure after token staging, (b) provider success followed by marker DB failure, and (c) retry without a code. Also submit exact-email and unrelated contact forms. | Apple signature/issuer/audience/expiry and the server-derived subject are verified; the other identity is rejected. Apple revocation keeps account deletion blocked until it succeeds. The server-returned token is durable before revocation, invisible to client roles, and retained on provider/marker failure. Retry uses only server state, then atomically records revocation and deletes the token. No provider token or secret is accepted from the client. `contact_submissions` has no authenticated-user key, so only exact normalized account-email matches are deleted. |
| **LIVE-11** | Seed the retention matrix, including security logs, paid/unpaid registrations, signed waiver, payment/provider metadata, completed/future availability, roster-only completed games, and stat-backed completed games. | Every field matches its delete/clear/retain classification. Waiver and financial records are reported as legally retained, not anonymous. Historical jersey/position/appearance/stat results remain reproducible. |
| **LIVE-12** | Run `supabase/tests/account_deletion_correction_pass_3_acceptance.sql` with completed/future referee assignments/swaps, referee tokens/availability, terminal/open season-return rows, notification send logs, backup tokens, migration requests, team billing actors, imported history and QuickBooks actors. | Tokens and open/future authority are absent; completed referee and terminal return facts are minimized exactly; every newly classified migration-only table matches the retention matrix. |
| **LIVE-13** | Call delayed request/cancel/status compatibility actions and reminder RPCs; seed pending/failed/cancelled legacy rows before applying the v1 migration. | Every compatibility call returns explicit unavailable-for-v1 guidance without mutation. Legacy work is cancelled, profile/request PII is scrubbed, completed audit timestamps/outcomes remain, and no reminder is sent. |

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
    ('public.prepare_account_deletion(uuid)'),
    ('public.stage_account_apple_revocation(uuid,text,text,text)'),
    ('public.get_account_apple_revocation_retry(uuid)'),
    ('public.mark_account_apple_revoked(uuid)'),
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
