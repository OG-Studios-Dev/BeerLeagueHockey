# Account-deletion retention matrix

This matrix is the implementation contract for immediate and scheduled account
deletion. “Retained” does not mean anonymous when the row still contains a
signature, payment record, IP address, or a foreign key to the anonymized
historical profile.

| Table | Fields or link | Disposition | Reason and disclosure |
| --- | --- | --- | --- |
| `profiles` | Email, name, phone, address, emergency/medical/security fields, images, push token, Stripe customer ID, legacy link and account privileges | Replace or clear; retain the UUID plus non-identifying hockey attributes and `deleted_at` | The UUID anchors historical hockey facts. The retained row is named “Deleted User” and cannot authenticate. |
| `password_reset_log` | User ID, email, IP, user agent, failure detail | Delete | Security operations have no purpose after account deletion. |
| `user_sessions` | Session token, IP, user agent | Delete | Credential/session data. |
| `login_attempts_log`, `account_recovery_requests`, `password_reset_rate_limits` | Direct or email/IP-linked security workflow data | Delete when linked by user ID or the account email | Operational security data, not history. |
| `push_subscriptions`, `push_device_tokens`, `notifications`, `notification_delivery_log`, `user_notification_preferences` | Destinations, payloads and preferences | Delete | Operational messaging data. |
| `leagues` | `owner_id`, `created_by` | Block deletion until `owner_id` is transferred; then clear `created_by` | Both fields are used by repository authorization checks. A deletion-state trigger prevents ownership reassignment races. |
| `organizations` | `owner_user_id` | Block deletion until ownership is transferred | Ownership is current authorization; a deletion-state trigger prevents reassignment races. |
| `teams` | `captain_id` | Clear | Captain-only authorization must not survive deletion. |
| `league_scorekeepers` | Permission flags, active/status, contact fields, preferences and notes | Disable permissions and active status; clear contact/preferences/free text; retain assignment counts and anonymized display label | Removes scorekeeper authorization while preserving non-PII workload history. |
| `team_staff` | `user_id`, role, active interval and notes | Set inactive/end date and clear notes; retain historical role interval linked to the anonymized profile | No current staff authorization remains. |
| `scorekeeper_availability`, `scorekeeper_sessions` | Availability/preferences, access token, device data and actor links | Delete the user's availability and every session linked through scorekeeper/creator/deactivator/captain fields; null creator on other users' availability | Operational scheduling and credentials. |
| `game_scorekeeper_assignments`, `game_duties` | Current assignments and notes; completed assignment/payment/duty facts | Delete incomplete user assignments; retain completed facts with notes cleared | Removes current participation while preserving completed work/payment history. |
| `season_opt_ins` | Player/season participation intent | Delete | Current/future participation workflow. |
| `team_invites`, `league_join_requests`, `team_join_requests`, `player_approvals` | Tokens, contact/message/notes, applicant and reviewer/approver links | Delete the account's workflows; null reviewer/approver links on other users' rows | Operational access workflow and authored PII. |
| `team_rosters` | Team/season, dates, jersey, position, player type | Retain with `historical_retained = true`; set status inactive, clear leadership and notes | Preserves roster-only completed-game appearances and jersey/position history without current participation or authority. |
| `player_stats`, `goalie_stats`, `game_stats`, `game_events`, `stat_changes`, `player_badges` | Completed-game and award facts linked to the anonymized profile | Retain | Immutable sporting history. Free-text actor/audit fields are cleared where present. |
| `game_checkins` | Completed attendance category and optional note | Retain category; delete note | Historical appearance input. |
| `player_availability` | Game status and free-text reason | Retain completed-game category with reason cleared; delete non-completed rows | Required to reproduce completed-season appearances; future availability is operational. |
| `registration_submissions` | Draft, photo, previous leagues, notes, Stripe IDs; league/season/payment/waiver facts | Delete unpaid/unsigned rows. For paid or waiver-backed rows, clear drafts, image, free text and Stripe IDs and retain minimal league/season/amount/status facts | Registration workflow is removed; only a legal/financial anchor remains. |
| `player_waivers` | Signed name, signature data, signature type, acceptance timestamps, document hash/version and signing IP | Retain; clear user agent | A signed waiver is legally retained and is not anonymized. It remains linked to the anonymized profile and still contains the listed evidentiary identifiers. |
| `player_payments` | Amounts, currency, plan, status and dates; Stripe IDs, metadata, notes and reminder state | Retain financial facts; clear provider IDs, metadata, notes and operational reminder fields | Payment audit/tax facts are legally retained and are not anonymized. |
| `payment_transactions` | Amount, currency, type, status and timestamps; Stripe IDs, idempotency key, metadata and description | Retain financial facts; clear provider IDs, idempotency material, metadata and free text | Payment audit/tax facts are legally retained and are not anonymized. |
| `payments` | Amount, method, status and date; Stripe intent and notes | Retain financial facts; clear Stripe intent and notes | Payment audit facts remain linked to the anonymized profile and are not anonymized. |
| `player_payment_audit_log`, `player_payment_deletion_log`, `stripe_payment_history` | Financial audit events and snapshots | Retain event/amount/time facts; replace snapshots/metadata and provider identifiers with minimal retention markers | Financial audit data is legally retained and is not described as fully anonymized. |
| `contact_submissions` | Name, email, subject and message without a profile FK | Delete exact normalized email matches | The profile email is a proven indirect link. Unmatched submissions cannot safely be attributed and are handled by their separate retention schedule. |
| `league_memberships`, pending invites/join requests, captain invites, team messages, notification records, consents | Current access, workflow, authored text and preferences | Delete or null actor link | No current authorization or operational participation survives. |
| `sub_invitations`, `goalie_requests`, `goalie_ratings` | Accepted/filled sporting facts plus authored notes | Retain accepted/filled categorical facts; clear private/free text; delete incomplete workflow rows | Historical game/marketplace facts are preserved without account-authored text. |
| `audit_logs`, `admin_audit_log`, `game_audit_log` | Action/time facts plus user/IP/user-agent/details | Retain minimal action/time facts; clear identifiers and payload detail | Security/legal audit retention. These rows are de-identified, not guaranteed anonymous where other facts can re-identify an event. |
| `account_deletion_log` | Request state, retry email, Stripe customer ID, IP, user agent and errors | Keep retry payload only until its external step succeeds; then clear it. Retain timestamps and terminal outcome | Enables idempotent retries without permanent operational PII. |
| `account_deletion_state` | Apple marker, storage/database/Stripe/email step timestamps plus temporary email/customer retry payload | Keep markers and step timestamps; erase email/customer payload immediately after the corresponding step succeeds | Durable idempotency state; not a user-facing profile. |

## Remaining generated-type profile-link inventory

The following direct `profiles` relations in the generated database types are
historical facts, configuration authorship, or actor references rather than
current authorization. They remain linked only to the retained anonymized UUID;
where this migration handles account-authored free text or structured payloads,
those fields are cleared as described above:

- Sporting/game history: `game_checkins`, `game_events`, `game_stats`,
  `game_submissions`, `goalie_stats`, `goalie_season_stats`, `player_stats`,
  `player_career_stats`, `player_goalie_matchups`, `player_ratings`,
  `player_badges`, `league_awards`, `stat_changes`, `stat_disputes`,
  `suspensions`, `trade_players`, `trades`, and the derived
  `player_season_stats`/`special_teams_leaders` views.
- Completed draft/roster history: `draft_pool`, `draft_picks`,
  `draft_pick_trades`, `draft_roster_confirmations`, `draft_undo_log`,
  `drafts`, `team_rosters`, and `legacy_players`. These links do not grant
  access after active membership, captain, staff, scorekeeper, and opt-in paths
  are removed.
- Historical actor/configuration references: `articles`,
  `article_player_tags`, `admin_audit_log`, `game_audit_log`,
  `game_stat_entry_log`, `schedule_constraint_configs`, `standings_config`,
  `team_schedule_preferences`, `venue_availability`, `venue_blackout_dates`,
  `notification_templates`, `league_waiver_templates`,
  `organization_subscription_events`, and `scorekeeper_auto_assign_log`.
  Audit payload/network/free-text fields attributable to the account are
  minimized; the anonymized UUID may remain as the event actor.
- Operational rows explicitly erased elsewhere in the function: `draft_messages`,
  `email_drafts`, `team_messages`, `notifications`, `user_consents`,
  `user_notification_preferences`, `goalie_requests`, `goalie_ratings`,
  `sub_invitations`, `registration_submissions`, `team_registration_requests`,
  and `team_registrations`. Rows not attributable to the deleting UUID are not
  inferred to belong to it.
- Financial/legal links: `payments`, `player_payments`, `player_waivers`,
  `player_payment_deletion_log`, `payment_transactions`, and payment audit/history
  tables follow the exact non-anonymous retention rules in the table above.

Uploaded profile and registration images are deleted from the fixed server-side
allowlist (`avatars`, `player-avatars`, and `player-photos`) by authenticated
ownership prefixes. Bucket names and paths are never accepted from the request.
