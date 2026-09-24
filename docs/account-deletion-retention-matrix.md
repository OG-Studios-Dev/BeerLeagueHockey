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
| `notification_send_log` | User UUID and per-user payload/dedupe row | Delete | Operational notification targeting and payload data. |
| `leagues` | `owner_id`, `created_by` | Block deletion until `owner_id` is transferred; then clear `created_by` | Both fields are used by repository authorization checks. The preflight and writer trigger share a per-user transaction lock; assignments to deleting, deleted, or authless profiles are rejected. |
| `organizations` | `owner_user_id` | Block deletion until ownership is transferred | The preflight and writer trigger share a per-user transaction lock; assignments to deleting, deleted, or authless profiles are rejected. |
| `organization_members`, `league_ownerships` | Active/pending access and ownership rows | Delete the account's rows; clear its inviter link on other memberships | Writer triggers share the deletion lock and reject new/promotion assignments to deleting, deleted, or authless profiles. |
| `teams` | `captain_id` | Clear | Captain-only authorization must not survive deletion. |
| `league_scorekeepers` | Permission flags, active/status, contact fields, preferences and notes | Disable permissions and active status; clear contact/preferences/free text; retain assignment counts and anonymized display label | Removes scorekeeper authorization while preserving non-PII workload history. |
| `team_staff` | `user_id`, role, active interval and notes | Set inactive/end date and clear notes; retain historical role interval linked to the anonymized profile | No current staff authorization remains. |
| `scorekeeper_availability`, `scorekeeper_sessions`, `scorekeeper_swap_requests` | Availability/preferences, swap workflow, access token, device data and actor links | Delete the user's availability, swaps and every session linked through scorekeeper/creator/deactivator/captain fields; null creator on other users' availability | Operational scheduling and credentials. |
| `league_referees`, `referee_availability`, `referee_sessions`, `referee_swap_requests`, `game_officials` | Profile/contact/certification/preferences, referee identifiers, bearer tokens/device data, availability, swaps, and game assignments | Delete every bearer session and availability row; delete open/future swaps and assignments; deactivate/minimize the referee row; retain completed-game role/payment/timing facts only, with names, referee identifiers, jersey, notes, devices and actor links cleared | No referee portal access or future assignment survives. Completed officiating/payment facts remain non-identifying. |
| `game_scorekeeper_assignments`, `game_duties` | Current assignments and notes; completed assignment/payment/duty facts | Delete incomplete user assignments; retain completed facts with notes cleared | Removes current participation while preserving completed work/payment history. |
| `duty_rotation_settings` | Ordered future-selection UUID list and current index | Remove the UUID, reset the index, and disable an empty rotation | Prevents automatic future duty selection. |
| `season_opt_ins` | Player/season participation intent | Delete | Current/future participation workflow. |
| `season_team_returns` | Captain profile/contact, response token, outreach state, notes and metadata | Delete open/non-terminal rows. For `confirmed` or `declined` responses, retain only league/season/team/status plus the terminal timestamp; clear captain identity/contact, every response token, flags, outreach timestamps, notes and metadata | A terminal team-return fact is product history; campaign access and captain PII are not. |
| `season_team_return_campaigns` | Sending actor and league-owned campaign content/counts | Clear `sent_by`; retain the league campaign fact | The campaign belongs to the league and does not authorize its former sender. |
| `team_invites`, `league_join_requests`, `team_join_requests`, `player_approvals` | Tokens, contact/message/notes, applicant and reviewer/approver links | Delete the account's workflows; null reviewer/approver links on other users' rows | Operational access workflow and authored PII. |
| `team_rosters` | Team/season, dates, jersey, position, player type | Retain only rows whose roster interval covers a completed game, with `historical_retained = true`; delete other rows; set retained rows inactive, close `end_date` at the latest covered completed game, and clear leadership/notes | Preserves explicit completed-game roster history without future participation or open-ended selector authority. |
| `draft_auto_pick_log` | Nullable non-FK player UUID plus draft/pick/result telemetry | Retain the completed draft-operation fact linked to the anonymized UUID | The UUID resolves only to the retained “Deleted User” profile, and the log grants no draft or account authority. |
| `player_stats`, `goalie_stats`, `game_stats`, `game_events`, `stat_changes`, `player_badges` | Completed-game and award facts linked to the anonymized profile | Retain | Immutable sporting history. Free-text actor/audit fields are cleared where present. |
| `game_checkins` | Completed attendance category and optional note | Retain completed-game category and clear note; delete non-completed-game rows | Historical appearance input cannot become future selection state. |
| `player_availability` | Game status and free-text reason | Retain completed-game category with reason cleared; delete non-completed rows | Required to reproduce completed-season appearances; future availability is operational. |
| `registration_submissions` | Draft, photo, previous leagues, notes, Stripe IDs; league/season/payment/waiver facts | Delete unpaid/unsigned rows. For paid or waiver-backed rows, force `cancelled`, clear team/jersey assignments, drafts, image, free text and Stripe IDs, and retain minimal league/season/amount facts | Registration workflow is terminal and cannot feed pending/approved/waitlisted participation; only a legal/financial anchor remains. |
| `player_waivers` | Signed name, signature data, signature type, acceptance timestamps, document hash/version and signing IP | Retain; clear user agent | A signed waiver is legally retained and is not anonymized. It remains linked to the anonymized profile and still contains the listed evidentiary identifiers. |
| `player_payments` | Amounts, currency, plan, status and dates; Stripe IDs, metadata, notes and reminder state | Retain financial facts; clear provider IDs, metadata, notes and operational reminder fields | Payment audit/tax facts are legally retained and are not anonymized. |
| `payment_transactions` | Amount, currency, type, status and timestamps; Stripe IDs, idempotency key, metadata and description | Retain financial facts; clear provider IDs, idempotency material, metadata and free text | Payment audit/tax facts are legally retained and are not anonymized. |
| `payments` | Amount, method, status and date; Stripe intent and notes | Retain financial facts; clear Stripe intent and notes | Payment audit facts remain linked to the anonymized profile and are not anonymized. |
| `player_payment_audit_log`, `player_payment_deletion_log`, `payment_disputes`, `stripe_payment_history` | Financial audit/dispute events and snapshots | Retain event/amount/time facts; replace snapshots/metadata/free text and provider identifiers where not evidentiary with minimal retention markers; clear auth-user actors | Financial audit data is legally retained and is not described as fully anonymized. |
| `stripe_connect_payments`, `stripe_connect_audit_log` | Exact account email, provider metadata/free text, and actor | Retain minimum financial event facts; clear exact email, metadata/free text, and auth-user actor | Financial audit data is legally retained and is not anonymous merely because direct account identifiers were removed. |
| `stripe_subscriptions` | League-owned Stripe account/customer IDs and metadata | Retain under the league billing lifecycle; no profile/auth UUID or account contact field exists | This is organization subscription state, not an individual player's Stripe customer record. The deleting profile's own Stripe customer ID is handled on `profiles` and in deletion state. |
| `team_invoices`, `team_invoice_payments` | Payer/recorder UUID, provider IDs, reference numbers and notes | Retain amount/status/date facts; clear the deleting-account actor, provider IDs, references and free text | Team-level financial facts are retained without the former user's operational identity. |
| `league_finance_custom_items`, `league_quickbooks_connections`, `league_quickbooks_mappings`, `league_quickbooks_sync_runs`, `league_quickbooks_sync_entries` | Author/requester/connector UUIDs; organization-owned accounting configuration, credentials, and request/response snapshots | Clear deleting-account actor links; retain league-owned accounting data, connection credentials and transaction snapshots | Deleting an individual removes their linkage without disconnecting an organization-wide integration. Sync-entry JSON is keyed to the league connection, not a profile. |
| `league_backup_tokens` | Token hash and creator UUID | Revoke and rotate the hash for tokens created by the deleting account; clear creator | User-created export credentials must not survive account deletion. |
| `league_migration_requests` | Requester UUID, source URLs/assets/JSON and notes | Cancel and minimize non-completed requests; minimize completed requests and clear requester/source/free text | Open migration work is operational; completed scope/count/status facts may be retained. |
| `legacy_players`, `player_career_baselines` | Imported names, source identifiers/metadata and matched profile UUID | Retain aggregate historical statistics; remove the profile link, replace names, rotate source record identity and clear provenance metadata | Prevents retained imported data from reversing profile anonymization. |
| `player_rating_contexts` | Profile UUID and structured historical rating snapshot | Retain linked to the anonymized UUID | A historical derived hockey fact; it grants no access and contains no contact/token field. |
| `contact_submissions` | Name, email, subject and message without a profile FK | Delete exact normalized email matches | The profile email is a proven indirect link. Unmatched submissions cannot safely be attributed and are handled by their separate retention schedule. |
| `league_staff`, team/league contact fields, registration backup/contact fields | Exact normalized account email and matching phone | Disable/minimize the staff row or clear the exact contact fields | Removes indirect live contact/operational identity after the account is gone. |
| `league_memberships`, pending invites/join requests, captain/player invites, team messages, notification records, consents | Current access, workflow, authored text and preferences | Delete or null actor link | No current authorization or operational participation survives. |
| `sub_invitations`, `goalie_requests`, `goalie_request_notifications`, `goalie_ratings` | Accepted/filled sporting facts plus authored notes and notification accept tokens | Retain accepted/filled facts only for completed games; clear private/free text; delete open/future workflow rows and their notification tokens | Historical game/marketplace facts are preserved without future selection state. |
| `goalie_pool` | Email, phone, availability, preferred arenas and verification token without a profile FK | On exact normalized account-email match, deactivate, replace email/token, and clear phone/preferences/availability | Removes indirect marketplace access and contact data. |
| `suspensions` | Player discipline status, appeal workflow and private notes | Delete non-terminal player rows; retain only `served`/`denied` historical facts with appeal/private/review text and nullable deleting-account actor links cleared | An anonymized UUID cannot remain in an active, appealed, or pending discipline workflow. |
| `league_spare_pool`, `draft_pool`, `season_opt_ins` | Active spare eligibility, draft availability and participation intent | Deactivate/minimize spare rows; delete draft-pool and opt-in rows | These are live selection surfaces, not completed history. Completed draft picks remain separately. |
| `game_team_lineups` | Roster/placement JSON and author links | Remove the UUID from open/future layouts; minimize completed display data and clear author links | Published future lineups must not retain selection authority; completed layout facts may remain. |
| `account_deletion_provider_secrets` | Apple subject and server-exchanged revocation token/type | Keep only between server-side exchange and durably recorded revocation; never expose to client roles | Makes provider/network and post-provider DB failures retryable without accepting a client token or secret. |
| `audit_logs`, `admin_audit_log`, `game_audit_log` | Action/time facts plus user/IP/user-agent/details | Retain minimal action/time facts; clear identifiers and payload detail | Security/legal audit retention. These rows are de-identified, not guaranteed anonymous where other facts can re-identify an event. |
| `account_deletion_log` | Legacy delayed-request state, email, Stripe customer ID, IP, user agent and errors | Cancel pending/processing/failed legacy rows and scrub request PII; scrub completed-row PII while retaining only timestamps and terminal outcome | v1 creates no delayed requests; the remaining rows are a minimized legacy audit trail. |
| `account_deletion_state` | Explicit initiation/workflow state, Apple marker and revoked subject, storage/database/Stripe/email step timestamps, and temporary email/customer retry payload | Challenge-only rows are cancelled and scrubbed; retain active immediate markers and step timestamps; erase email/customer payload immediately after its external step succeeds | Only `immediate` plus `irreversible`/`database_deleted` is active. Cancelled/failed/expired rows never block, and provider retry credentials remain separately locked down. |

## Remaining generated-type profile-link inventory

The following direct `profiles` relations in the generated database types are
historical facts, configuration authorship, or actor references rather than
current authorization. They remain linked only to the retained anonymized UUID;
where this migration handles account-authored free text or structured payloads,
those fields are cleared as described above:

- Sporting/game history: `game_checkins`, `game_events`, `game_stats`,
  `game_submissions`, `goalie_stats`, `goalie_season_stats`, `player_stats`,
  `player_career_stats`, `player_goalie_matchups`, `player_ratings`,
  `player_badges`, `league_awards`, `stat_changes`, `stat_disputes`, terminal
  `suspensions`, `trade_players`, `trades`, and the derived
  `player_season_stats`/`special_teams_leaders` views.
- Completed draft/roster history: `draft_picks`,
  `draft_pick_trades`, `draft_roster_confirmations`, `draft_undo_log`,
  `drafts`, `draft_auto_pick_log`, `team_rosters`, and `legacy_players`. These links do not grant
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
- Other migration-chain configuration authorship links are explicit:
  `schedule_rules`, `season_fees`, `sponsor_placements`, and
  `stat_definitions` retain league configuration/business facts but clear the
  deleting account's nullable `created_by` link.
- Migration-only relations absent from the generated snapshot are also
  classified: referee lifecycle tables, season return rows/campaigns,
  `notification_send_log`, `team_invoices`, `team_invoice_payments`,
  `league_finance_custom_items`, `league_backup_tokens`,
  `league_migration_requests`, QuickBooks connection/mapping/sync rows,
  `league_quickbooks_sync_entries`, `player_rating_contexts`,
  `draft_auto_pick_log`, and `player_career_baselines`. Pass 3 validates
  their exact relation/column shapes before storage or provider side effects.
- Operational rows explicitly erased elsewhere in the function: `draft_messages`,
  `email_drafts`, `team_messages`, `notifications`, `user_consents`,
  `user_notification_preferences`, `goalie_requests`, `goalie_ratings`,
  `sub_invitations`, `registration_submissions`, `team_registration_requests`,
  `team_registrations`, `organization_members`, `league_ownerships`,
  `scorekeeper_swap_requests`, and duty-rotation UUID entries. Rows not
  attributable to the deleting UUID are not
  inferred to belong to it.
- Additional generated relations: `bug_reports` are deleted for the reporter
  and have resolver links cleared; `captain_player_invites` are deleted for the
  target/inviter/consumer; `games` retain the fixture while clearing deleting
  account actor/unlock links. These rows grant no post-deletion authority.
- Financial/legal links: `payments`, `player_payments`, `player_waivers`,
  `player_payment_deletion_log`, `payment_transactions`, and payment audit/history
  tables follow the exact non-anonymous retention rules in the table above.

The migration-chain scan also found generic JSON/provider/contact columns that
are not attributable to the deleting profile: venue phone fields belong to the
venue, QuickBooks sync-entry snapshots belong to the league connection, and
`stripe_subscriptions` belongs to league billing. They are deliberately not
matched by value to a player's phone, profile UUID, or Stripe customer ID.

Uploaded profile and registration images are deleted from the fixed server-side
allowlist (`avatars`, `player-avatars`, and `player-photos`) by authenticated
ownership prefixes. Bucket names and paths are never accepted from the request.
