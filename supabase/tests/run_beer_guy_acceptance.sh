#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREREQUISITE_MIGRATION="$ROOT/supabase/migrations/20261016010000_leagues_timezone_not_null.sql"
FK_HARDENING_MIGRATION="$ROOT/supabase/migrations/20261016015000_game_duties_duty_type_fk_no_action.sql"
MIGRATION="$ROOT/supabase/migrations/20261016020000_beer_guy_authority.sql"
FIXTURE="$ROOT/supabase/tests/beer_guy_fixture.sql"
TEST_FILES="${BEER_GUY_ACCEPTANCE_FILES:-beer_guy_catalog_acceptance.sql beer_guy_legacy_reconciliation_acceptance.sql beer_guy_assignment_invariant_acceptance.sql beer_guy_substitute_acceptance.sql beer_guy_attendance_lifecycle_acceptance.sql beer_guy_self_claim_acceptance.sql beer_guy_captain_acceptance.sql beer_guy_reply_scope_acceptance.sql beer_guy_reads_history_acceptance.sql beer_guy_new_team_acceptance.sql beer_guy_identity_lifecycle_acceptance.sql beer_guy_security_acceptance.sql beer_guy_cross_league_acceptance.sql beer_guy_checkin_select_acceptance.sql beer_guy_self_contained_invitation_rls_acceptance.sql beer_guy_self_contained_checkin_rls_acceptance.sql beer_guy_realtime_publication_acceptance.sql}"
PG_ROOT="${TMPDIR:-/tmp}/hockey-life-beer-guy-pg-$$"
PG_DATA="$PG_ROOT/data"
PG_LOG="$PG_ROOT/postgres.log"
PG_HOST="127.0.0.1"
PORT="55439"
DB_NAME="beer_guy_acceptance"

mkdir -p "$PG_ROOT"
cleanup() {
  if [[ -d "$PG_DATA" ]]; then
    pg_ctl -D "$PG_DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$PG_ROOT"
}
trap cleanup EXIT INT TERM

initdb -D "$PG_DATA" -A trust -U postgres --no-locale >/dev/null
if ! pg_ctl -D "$PG_DATA" -l "$PG_LOG" -o "-h $PG_HOST -p $PORT -F -c wal_level=logical -c unix_socket_directories=''" start >/dev/null; then
  printf '%s\n' 'PostgreSQL failed to start:' >&2
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_LOG"
  exit 1
fi
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PORT" -U postgres -d "$DB_NAME")

apply_prerequisite_migration() {
  if [[ ! -f "$PREREQUISITE_MIGRATION" ]]; then
    printf 'missing prerequisite migration: %s\n' "$PREREQUISITE_MIGRATION" >&2
    exit 1
  fi
  "${PSQL[@]}" -f "$PREREQUISITE_MIGRATION"
}

apply_fk_hardening_migration() {
  if [[ ! -f "$FK_HARDENING_MIGRATION" ]]; then
    printf 'missing FK hardening migration: %s\n' "$FK_HARDENING_MIGRATION" >&2
    exit 1
  fi
  "${PSQL[@]}" -f "$FK_HARDENING_MIGRATION"
}

prepare_database() {
  local test_file="${1:-}"
  local realtime_baseline="${2:-empty}"
  dropdb --if-exists -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME" >/dev/null 2>&1 || true
  createdb -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME"
  "${PSQL[@]}" -f "$FIXTURE"
  if [[ "$test_file" == "beer_guy_self_contained_invitation_rls_acceptance.sql" ]]; then
    "${PSQL[@]}" -c 'DROP POLICY fixture_sub_invitations_all ON public.sub_invitations'
  elif [[ "$test_file" == "beer_guy_self_contained_checkin_rls_acceptance.sql" ]]; then
    "${PSQL[@]}" -c 'DROP POLICY fixture_checkins_all ON public.game_checkins; DROP POLICY fixture_sub_invitations_all ON public.sub_invitations'
  elif [[ "$test_file" == "beer_guy_realtime_publication_acceptance.sql" ]]; then
    if [[ "$realtime_baseline" == "game_duties_already_published" ]]; then
      "${PSQL[@]}" -c 'ALTER PUBLICATION supabase_realtime ADD TABLE public.game_duties'
    elif [[ "$realtime_baseline" == "game_checkins_already_published" ]]; then
      "${PSQL[@]}" -c 'ALTER PUBLICATION supabase_realtime ADD TABLE public.game_checkins'
    elif [[ "$realtime_baseline" == "both_already_published" ]]; then
      "${PSQL[@]}" -c 'ALTER PUBLICATION supabase_realtime ADD TABLE public.game_duties, public.game_checkins'
    fi
  fi
  if [[ "${BEER_GUY_SKIP_MIGRATION:-0}" != "1" ]]; then
    apply_prerequisite_migration
    apply_fk_hardening_migration
    if [[ ! -f "$MIGRATION" ]]; then
      printf 'missing migration: %s\n' "$MIGRATION" >&2
      exit 1
    fi
    "${PSQL[@]}" -f "$MIGRATION"
  fi
}

run_concurrency() {
  set +e
  "${PSQL[@]}" -c "SET ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000011',false); INSERT INTO public.beer_guy_concurrency_results(actor_id,result) SELECT '40000000-0000-4000-8000-000000000011', public.beer_guy_claim('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001');" >"$PG_ROOT/racer-one.log" 2>&1 &
  racer_one_pid=$!
  "${PSQL[@]}" -c "SET ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000012',false); INSERT INTO public.beer_guy_concurrency_results(actor_id,result) SELECT '40000000-0000-4000-8000-000000000012', public.beer_guy_claim('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001');" >"$PG_ROOT/racer-two.log" 2>&1 &
  racer_two_pid=$!
  wait "$racer_one_pid"; racer_one_status=$?
  wait "$racer_two_pid"; racer_two_status=$?
  set -e
  if [[ "$racer_one_status" -ne 0 || "$racer_two_status" -ne 0 ]]; then
    printf '%s\n' 'racer one:' >&2
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/racer-one.log"
    printf '%s\n' 'racer two:' >&2
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/racer-two.log"
    exit 1
  fi
}

run_invalidation_concurrency() {
  "${PSQL[@]}" -c "INSERT INTO public.sub_invitations(id,game_id,team_id,invited_by,invited_player_id,status,source_type) VALUES ('80000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011','pending','league')" >/dev/null

  set +e
  "${PSQL[@]}" -c "BEGIN; UPDATE public.sub_invitations SET status = 'accepted', responded_at = pg_catalog.now() WHERE id = '80000000-0000-4000-8000-000000000002'; SELECT pg_catalog.pg_sleep(2); COMMIT;" >"$PG_ROOT/sub-accept-racer.log" 2>&1 &
  sub_accept_pid=$!
  sleep 0.35
  "${PSQL[@]}" -c "SET ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000011',false); SELECT public.beer_guy_claim('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001');" >"$PG_ROOT/sub-claim-racer.log" 2>&1 &
  sub_claim_pid=$!
  wait "$sub_accept_pid"; sub_accept_status=$?
  wait "$sub_claim_pid"; sub_claim_status=$?
  set -e
  if [[ "$sub_accept_status" -ne 0 ]]; then
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/sub-accept-racer.log"
    exit 1
  fi
  sub_invalid_count="$("${PSQL[@]}" -Atc "SELECT pg_catalog.count(*) FROM public.game_duties gd JOIN public.duty_types dt ON dt.id = gd.duty_type_id WHERE dt.system_key = 'beer_guy' AND gd.game_id = '50000000-0000-4000-8000-000000000002' AND gd.team_id = '30000000-0000-4000-8000-000000000001' AND gd.assigned_player_id = '40000000-0000-4000-8000-000000000011'")"
  if [[ "$sub_invalid_count" != "0" ]]; then
    printf 'accepted-substitute race left %s invalid Beer assignment(s); claim status=%s\n' "$sub_invalid_count" "$sub_claim_status" >&2
    exit 1
  fi

  set +e
  "${PSQL[@]}" -c "BEGIN; UPDATE public.profiles SET deleted_at = pg_catalog.now() WHERE id = '40000000-0000-4000-8000-000000000012'; SELECT pg_catalog.pg_sleep(2); COMMIT;" >"$PG_ROOT/profile-delete-racer.log" 2>&1 &
  profile_delete_pid=$!
  sleep 0.35
  "${PSQL[@]}" -c "SET ROLE authenticated; SELECT pg_catalog.set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000012',false); SELECT public.beer_guy_claim('50000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001');" >"$PG_ROOT/profile-claim-racer.log" 2>&1 &
  profile_claim_pid=$!
  wait "$profile_delete_pid"; profile_delete_status=$?
  wait "$profile_claim_pid"; profile_claim_status=$?
  set -e
  if [[ "$profile_delete_status" -ne 0 ]]; then
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/profile-delete-racer.log"
    exit 1
  fi
  profile_invalid_count="$("${PSQL[@]}" -Atc "SELECT pg_catalog.count(*) FROM public.game_duties gd JOIN public.duty_types dt ON dt.id = gd.duty_type_id WHERE dt.system_key = 'beer_guy' AND gd.game_id = '50000000-0000-4000-8000-000000000003' AND gd.team_id = '30000000-0000-4000-8000-000000000001' AND gd.assigned_player_id = '40000000-0000-4000-8000-000000000012'")"
  if [[ "$profile_invalid_count" != "0" ]]; then
    printf 'profile-deletion race left %s invalid Beer assignment(s); claim status=%s\n' "$profile_invalid_count" "$profile_claim_status" >&2
    exit 1
  fi
}

run_team_provisioning_migration_race() {
  dropdb --if-exists -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME" >/dev/null 2>&1 || true
  createdb -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME"
  "${PSQL[@]}" -f "$FIXTURE" >/dev/null
  apply_prerequisite_migration >/dev/null
  apply_fk_hardening_migration >/dev/null

  set +e
  "${PSQL[@]}" -c "BEGIN; INSERT INTO public.teams(id,league_id,name) VALUES ('30000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','Concurrent Expansion'); SELECT pg_catalog.pg_sleep(2) /* beer-guy-team-race-inserter */; COMMIT;" >"$PG_ROOT/team-insert-racer.log" 2>&1 &
  team_insert_pid=$!
  set -e

  race_ready=0
  for _ in {1..100}; do
    if [[ "$("${PSQL[@]}" -Atc "SELECT pg_catalog.count(*) FROM pg_catalog.pg_stat_activity WHERE datname = '$DB_NAME' AND query LIKE '%beer-guy-team-race-inserter%' AND wait_event = 'PgSleep'")" == "1" ]]; then
      race_ready=1
      break
    fi
    sleep 0.05
  done
  if [[ "$race_ready" != "1" ]]; then
    printf '%s\n' 'concurrent team inserter did not reach the controlled pre-commit gate' >&2
    wait "$team_insert_pid" || true
    exit 1
  fi

  set +e
  "${PSQL[@]}" -f "$MIGRATION" >"$PG_ROOT/team-migration-racer.log" 2>&1 &
  team_migration_pid=$!
  wait "$team_insert_pid"; team_insert_status=$?
  wait "$team_migration_pid"; team_migration_status=$?
  set -e
  if [[ "$team_insert_status" -ne 0 || "$team_migration_status" -ne 0 ]]; then
    printf '%s\n' 'team inserter:' >&2
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/team-insert-racer.log"
    printf '%s\n' 'migration racer:' >&2
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/team-migration-racer.log"
    exit 1
  fi

  concurrent_duty_count="$("${PSQL[@]}" -Atc "SELECT pg_catalog.count(*) FROM public.duty_types WHERE team_id = '30000000-0000-4000-8000-000000000099' AND system_key = 'beer_guy'")"
  if [[ "$concurrent_duty_count" != "1" ]]; then
    printf 'concurrently committed team received %s canonical Beer Guy duties; expected exactly 1\n' "$concurrent_duty_count" >&2
    exit 1
  fi
  printf '%s\n' 'beer guy two-session migration/team-insert race acceptance passed'
}

if [[ "${BEER_GUY_RUN_TEAM_PROVISIONING_RACE_ONLY:-0}" == "1" ]]; then
  run_team_provisioning_migration_race
  exit 0
fi

if [[ "${BEER_GUY_RUN_PREFLIGHT_REJECTION:-0}" == "1" ]]; then
  PREFLIGHT_CASES="${BEER_GUY_PREFLIGHT_CASES:-missing_column missing_uniqueness missing_checkin_uniqueness missing_sub_column missing_sub_fk missing_sub_status_constraint missing_parent_fk wrong_hierarchy_delete_action wrong_duty_type_delete_action wrong_assigned_player_delete_action missing_id_default invalid_status_vocabulary rls_disabled function_owner function_collision authenticated_acl_missing service_acl_missing missing_realtime_publication realtime_publication_operations realtime_publication_row_filter realtime_publication_column_list realtime_publication_authority ambiguous_duties}"
  for rejection_case in $PREFLIGHT_CASES; do
    dropdb --if-exists -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME" >/dev/null 2>&1 || true
    createdb -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME"
    "${PSQL[@]}" -f "$FIXTURE" >/dev/null
    apply_prerequisite_migration >/dev/null
    apply_fk_hardening_migration >/dev/null
    MIGRATION_PSQL=("${PSQL[@]}")
    if [[ "$rejection_case" == "missing_column" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP COLUMN notes' >/dev/null
    elif [[ "$rejection_case" == "missing_uniqueness" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_game_type_team_key' >/dev/null
    elif [[ "$rejection_case" == "missing_checkin_uniqueness" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.game_checkins DROP CONSTRAINT game_checkins_game_player_key' >/dev/null
    elif [[ "$rejection_case" == "missing_sub_column" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.sub_invitations DROP COLUMN responded_at' >/dev/null
    elif [[ "$rejection_case" == "missing_sub_fk" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.sub_invitations DROP CONSTRAINT sub_invitations_game_id_fkey' >/dev/null
    elif [[ "$rejection_case" == "missing_sub_status_constraint" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.sub_invitations DROP CONSTRAINT sub_invitations_status_check' >/dev/null
    elif [[ "$rejection_case" == "missing_parent_fk" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_team_id_fkey' >/dev/null
    elif [[ "$rejection_case" == "wrong_hierarchy_delete_action" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.teams DROP CONSTRAINT teams_league_id_fkey, ADD CONSTRAINT teams_league_id_fkey FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE NO ACTION' >/dev/null
    elif [[ "$rejection_case" == "wrong_duty_type_delete_action" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON DELETE CASCADE' >/dev/null
    elif [[ "$rejection_case" == "wrong_assigned_player_delete_action" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_assigned_player_id_fkey, ADD CONSTRAINT game_duties_assigned_player_id_fkey FOREIGN KEY (assigned_player_id) REFERENCES public.profiles(id) ON DELETE CASCADE' >/dev/null
    elif [[ "$rejection_case" == "missing_id_default" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.duty_types ALTER COLUMN id DROP DEFAULT' >/dev/null
    elif [[ "$rejection_case" == "invalid_status_vocabulary" ]]; then
      "${PSQL[@]}" -c "ALTER TYPE public.game_status RENAME VALUE 'postponed' TO 'delayed'" >/dev/null
    elif [[ "$rejection_case" == "rls_disabled" ]]; then
      "${PSQL[@]}" -c 'ALTER TABLE public.sub_invitations DISABLE ROW LEVEL SECURITY' >/dev/null
    elif [[ "$rejection_case" == "function_owner" ]]; then
      "${PSQL[@]}" -c 'CREATE ROLE fixture_other_owner NOLOGIN; ALTER FUNCTION public.captain_manage_game_checkin(uuid,uuid,uuid,text,text) OWNER TO fixture_other_owner' >/dev/null
    elif [[ "$rejection_case" == "function_collision" ]]; then
      "${PSQL[@]}" -c "CREATE FUNCTION public.beer_guy_claim(uuid,uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT pg_catalog.jsonb_build_object(''unexpected'', true)'" >/dev/null
    elif [[ "$rejection_case" == "authenticated_acl_missing" ]]; then
      "${PSQL[@]}" -c 'REVOKE ALL ON public.game_duties FROM authenticated' >/dev/null
    elif [[ "$rejection_case" == "service_acl_missing" ]]; then
      "${PSQL[@]}" -c 'REVOKE ALL ON public.game_checkins FROM service_role' >/dev/null
    elif [[ "$rejection_case" == "missing_realtime_publication" ]]; then
      "${PSQL[@]}" -c 'DROP PUBLICATION supabase_realtime' >/dev/null
    elif [[ "$rejection_case" == "realtime_publication_operations" ]]; then
      "${PSQL[@]}" -c "ALTER PUBLICATION supabase_realtime SET (publish = 'insert')" >/dev/null
    elif [[ "$rejection_case" == "realtime_publication_row_filter" ]]; then
      "${PSQL[@]}" -c "ALTER PUBLICATION supabase_realtime ADD TABLE public.game_duties WHERE (status = 'pending')" >/dev/null
    elif [[ "$rejection_case" == "realtime_publication_column_list" ]]; then
      "${PSQL[@]}" -c 'ALTER PUBLICATION supabase_realtime ADD TABLE public.game_checkins (id, game_id, team_id)' >/dev/null
    elif [[ "$rejection_case" == "realtime_publication_authority" ]]; then
      "${PSQL[@]}" -c 'CREATE ROLE fixture_realtime_migration_owner LOGIN; GRANT USAGE ON SCHEMA auth TO fixture_realtime_migration_owner; GRANT USAGE, CREATE ON SCHEMA public TO fixture_realtime_migration_owner; ALTER TABLE public.leagues OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.teams OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.seasons OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.games OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.profiles OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.team_rosters OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.game_checkins OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.duty_types OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.game_duties OWNER TO fixture_realtime_migration_owner; ALTER TABLE public.sub_invitations OWNER TO fixture_realtime_migration_owner; ALTER FUNCTION public.captain_manage_game_checkin(uuid,uuid,uuid,text,text) OWNER TO fixture_realtime_migration_owner' >/dev/null
      MIGRATION_PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PORT" -U fixture_realtime_migration_owner -d "$DB_NAME")
    elif [[ "$rejection_case" == "ambiguous_duties" ]]; then
      "${PSQL[@]}" -c "INSERT INTO public.duty_types(id,team_id,name) VALUES ('60000000-0000-4000-8000-000000000099','30000000-0000-4000-8000-000000000002','beer_guy')" >/dev/null
    else
      printf 'unknown Beer Guy preflight case: %s\n' "$rejection_case" >&2
      exit 2
    fi
    set +e
    "${MIGRATION_PSQL[@]}" -f "$MIGRATION" >"$PG_ROOT/preflight-$rejection_case.log" 2>&1
    migration_status=$?
    set -e
    if [[ "$migration_status" -eq 0 ]]; then
      printf 'incompatible baseline case %s unexpectedly accepted\n' "$rejection_case" >&2
      exit 1
    fi
    if ! grep -q 'Beer Guy baseline is incompatible\|Beer Guy baseline is ambiguous' "$PG_ROOT/preflight-$rejection_case.log"; then
      while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/preflight-$rejection_case.log"
      printf 'migration case %s failed without the expected preflight diagnostic\n' "$rejection_case" >&2
      exit 1
    fi
    if [[ "$rejection_case" == "wrong_hierarchy_delete_action" ||
          "$rejection_case" == "wrong_duty_type_delete_action" ||
          "$rejection_case" == "wrong_assigned_player_delete_action" ]] &&
       ! grep -q 'missing or mismatched foreign keys' "$PG_ROOT/preflight-$rejection_case.log"; then
      while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/preflight-$rejection_case.log"
      printf 'migration case %s failed for the wrong FK-action reason\n' "$rejection_case" >&2
      exit 1
    fi
    expected_realtime_diagnostic=""
    if [[ "$rejection_case" == "missing_realtime_publication" ]]; then
      expected_realtime_diagnostic='supabase_realtime publication is missing'
    elif [[ "$rejection_case" == "realtime_publication_operations" ]]; then
      expected_realtime_diagnostic='must publish insert, update, and delete changes'
    elif [[ "$rejection_case" == "realtime_publication_row_filter" || "$rejection_case" == "realtime_publication_column_list" ]]; then
      expected_realtime_diagnostic='cannot use publication row or column filters'
    elif [[ "$rejection_case" == "realtime_publication_authority" ]]; then
      expected_realtime_diagnostic='cannot alter supabase_realtime publication'
    fi
    if [[ -n "$expected_realtime_diagnostic" ]] && ! grep -q "$expected_realtime_diagnostic" "$PG_ROOT/preflight-$rejection_case.log"; then
      while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/preflight-$rejection_case.log"
      printf 'migration case %s failed for the wrong Realtime reason\n' "$rejection_case" >&2
      exit 1
    fi
    if grep -Eq '^(LOCK TABLE|ALTER TABLE|UPDATE [0-9]|CREATE INDEX|INSERT [0-9])' "$PG_ROOT/preflight-$rejection_case.log"; then
      while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/preflight-$rejection_case.log"
      printf 'migration case %s reached a write before preflight rejection\n' "$rejection_case" >&2
      exit 1
    fi
    partial_columns="$("${PSQL[@]}" -Atc "SELECT pg_catalog.count(*) FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'duty_types' AND column_name = 'system_key') OR (table_name = 'game_duties' AND column_name = 'assignment_version'))")"
    if [[ "$partial_columns" != "0" ]]; then
      printf 'incompatible baseline case %s left %s partial Beer Guy columns\n' "$rejection_case" "$partial_columns" >&2
      exit 1
    fi
  done
  printf '%s\n' 'beer guy incompatible/ambiguous baseline preflight acceptance passed'
  exit 0
fi

for test_file in $TEST_FILES; do
  realtime_baselines="empty"
  if [[ "$test_file" == "beer_guy_realtime_publication_acceptance.sql" ]]; then
    realtime_baselines="empty game_duties_already_published game_checkins_already_published both_already_published"
  fi
  for realtime_baseline in $realtime_baselines; do
    prepare_database "$test_file" "$realtime_baseline"
    if [[ "$test_file" == "beer_guy_self_claim_acceptance.sql" && "${BEER_GUY_RUN_CONCURRENCY:-1}" == "1" ]]; then
      run_concurrency
    fi
    "${PSQL[@]}" -f "$ROOT/supabase/tests/$test_file"
  done
done

if [[ "${BEER_GUY_RUN_CONCURRENCY:-1}" == "1" ]]; then
  prepare_database
  run_invalidation_concurrency
  run_team_provisioning_migration_race
fi
