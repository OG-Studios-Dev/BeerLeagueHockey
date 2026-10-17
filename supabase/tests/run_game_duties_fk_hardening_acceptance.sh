#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$ROOT/supabase/tests/beer_guy_fixture.sql"
MIGRATION="$ROOT/supabase/migrations/20261016015000_game_duties_duty_type_fk_no_action.sql"
PG_ROOT="${TMPDIR:-/tmp}/hockey-life-fk-hardening-pg-$$"
PG_DATA="$PG_ROOT/data"
PG_LOG="$PG_ROOT/postgres.log"
PG_HOST="127.0.0.1"
PORT="55440"
DB_NAME="fk_hardening_acceptance"

mkdir -p "$PG_ROOT"
cleanup() {
  if [[ -d "$PG_DATA" ]]; then
    pg_ctl -D "$PG_DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$PG_ROOT"
}
trap cleanup EXIT INT TERM

if [[ ! -f "$FIXTURE" || ! -f "$MIGRATION" ]]; then
  printf 'missing fixture or FK hardening migration\n' >&2
  exit 1
fi

initdb -D "$PG_DATA" -A trust -U postgres --no-locale >/dev/null
if ! pg_ctl -D "$PG_DATA" -l "$PG_LOG" -o "-h $PG_HOST -p $PORT -F -c wal_level=logical -c unix_socket_directories=''" start >/dev/null; then
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_LOG"
  exit 1
fi
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PORT" -U postgres -d "$DB_NAME")

reset_database() {
  dropdb --if-exists -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME" >/dev/null 2>&1 || true
  createdb -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME"
  "${PSQL[@]}" -f "$FIXTURE" >/dev/null
}

query_value() {
  "${PSQL[@]}" -Atc "$1"
}

data_fingerprint() {
  query_value "SELECT pg_catalog.md5(COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(gd) ORDER BY gd.id)::text, '[]')) FROM public.game_duties AS gd"
}

unrelated_fk_fingerprint() {
  query_value "SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(source_ns.nspname || '.' || source_table.relname || ':' || con.conname || ':' || pg_catalog.pg_get_constraintdef(con.oid, false) || ':' || con.convalidated::text || ':' || con.condeferrable::text || ':' || con.condeferred::text, E'\\n' ORDER BY source_ns.nspname, source_table.relname, con.conname), '')) FROM pg_catalog.pg_constraint AS con JOIN pg_catalog.pg_class AS source_table ON source_table.oid = con.conrelid JOIN pg_catalog.pg_namespace AS source_ns ON source_ns.oid = source_table.relnamespace WHERE con.contype = 'f' AND NOT (con.conrelid = 'public.game_duties'::pg_catalog.regclass AND con.conname = 'game_duties_duty_type_id_fkey')"
}

all_fk_fingerprint() {
  query_value "SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(source_ns.nspname || '.' || source_table.relname || ':' || con.conname || ':' || pg_catalog.pg_get_constraintdef(con.oid, false) || ':' || con.convalidated::text || ':' || con.condeferrable::text || ':' || con.condeferred::text, E'\\n' ORDER BY source_ns.nspname, source_table.relname, con.conname), '')) FROM pg_catalog.pg_constraint AS con JOIN pg_catalog.pg_class AS source_table ON source_table.oid = con.conrelid JOIN pg_catalog.pg_namespace AS source_ns ON source_ns.oid = source_table.relnamespace WHERE con.contype = 'f'"
}

# Hosted transition: exact CASCADE baseline to exact NO ACTION postcondition.
reset_database
"${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON DELETE CASCADE' >/dev/null
before_data="$(data_fingerprint)"
before_unrelated="$(unrelated_fk_fingerprint)"
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
post_exact_count="$(query_value "SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = 'public.game_duties'::pg_catalog.regclass AND con.conname = 'game_duties_duty_type_id_fkey' AND con.contype = 'f' AND con.confrelid = 'public.duty_types'::pg_catalog.regclass AND con.conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = con.conrelid AND attname = 'duty_type_id')]::smallint[] AND con.confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = con.confrelid AND attname = 'id')]::smallint[] AND con.convalidated AND NOT con.condeferrable AND NOT con.condeferred AND con.confmatchtype = 's' AND con.confupdtype = 'a' AND con.confdeltype = 'a'")"
edge_count="$(query_value "SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = 'public.game_duties'::pg_catalog.regclass AND con.contype = 'f' AND con.confrelid = 'public.duty_types'::pg_catalog.regclass AND con.conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = con.conrelid AND attname = 'duty_type_id')]::smallint[] AND con.confkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = con.confrelid AND attname = 'id')]::smallint[]")"
if [[ "$post_exact_count" != "1" || "$edge_count" != "1" ]]; then
  printf 'hosted transition did not produce one exact protected FK (exact=%s edge=%s)\n' "$post_exact_count" "$edge_count" >&2
  exit 1
fi
if [[ "$(data_fingerprint)" != "$before_data" ]]; then
  printf '%s\n' 'hosted transition changed game_duties data' >&2
  exit 1
fi
if [[ "$(unrelated_fk_fingerprint)" != "$before_unrelated" ]]; then
  printf '%s\n' 'hosted transition changed an unrelated FK' >&2
  exit 1
fi
post_oid="$(query_value "SELECT oid FROM pg_catalog.pg_constraint WHERE conrelid = 'public.game_duties'::pg_catalog.regclass AND conname = 'game_duties_duty_type_id_fkey'")"
post_all_fk="$(all_fk_fingerprint)"
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
if [[ "$(query_value "SELECT oid FROM pg_catalog.pg_constraint WHERE conrelid = 'public.game_duties'::pg_catalog.regclass AND conname = 'game_duties_duty_type_id_fkey'")" != "$post_oid" || "$(all_fk_fingerprint)" != "$post_all_fk" || "$(data_fingerprint)" != "$before_data" ]]; then
  printf '%s\n' 'already-applied migration was not a metadata/data no-op' >&2
  exit 1
fi
printf '%s\n' 'FK hardening hosted transition and idempotency acceptance passed'

# Every malformed shape must fail closed and leave catalog/data bytes unchanged.
REJECTION_CASES="missing_constraint renamed_constraint wrong_delete_action deferrable_constraint unvalidated_constraint wrong_update_action wrong_columns duplicate_edge"
for rejection_case in $REJECTION_CASES; do
  reset_database
  case "$rejection_case" in
    missing_constraint)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey' >/dev/null
      ;;
    renamed_constraint)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_renamed_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON DELETE NO ACTION' >/dev/null
      ;;
    wrong_delete_action)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON DELETE SET NULL' >/dev/null
      ;;
    deferrable_constraint)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE' >/dev/null
      ;;
    unvalidated_constraint)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON DELETE NO ACTION NOT VALID' >/dev/null
      ;;
    wrong_update_action)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON UPDATE CASCADE ON DELETE NO ACTION' >/dev/null
      ;;
    wrong_columns)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties DROP CONSTRAINT game_duties_duty_type_id_fkey, ADD CONSTRAINT game_duties_duty_type_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE NO ACTION' >/dev/null
      ;;
    duplicate_edge)
      "${PSQL[@]}" -c 'ALTER TABLE public.game_duties ADD CONSTRAINT game_duties_duty_type_id_duplicate_fkey FOREIGN KEY (duty_type_id) REFERENCES public.duty_types(id) ON DELETE NO ACTION' >/dev/null
      ;;
    *)
      printf 'unknown hardening rejection case: %s\n' "$rejection_case" >&2
      exit 2
      ;;
  esac

  before_catalog="$(all_fk_fingerprint)"
  before_data="$(data_fingerprint)"
  set +e
  "${PSQL[@]}" -f "$MIGRATION" >"$PG_ROOT/$rejection_case.log" 2>&1
  migration_status=$?
  set -e
  if [[ "$migration_status" -eq 0 ]]; then
    printf 'hardening rejection case %s unexpectedly succeeded\n' "$rejection_case" >&2
    exit 1
  fi
  if ! grep -q 'game_duties duty-type FK hardening baseline is incompatible' "$PG_ROOT/$rejection_case.log"; then
    while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_ROOT/$rejection_case.log"
    printf 'hardening rejection case %s failed for an unexpected reason\n' "$rejection_case" >&2
    exit 1
  fi
  if [[ "$(all_fk_fingerprint)" != "$before_catalog" || "$(data_fingerprint)" != "$before_data" ]]; then
    printf 'hardening rejection case %s changed catalog or data before failing\n' "$rejection_case" >&2
    exit 1
  fi
  printf 'FK hardening rejection case passed: %s\n' "$rejection_case"
done

printf 'game_duties FK hardening acceptance matrix passed (%s scenarios)\n' 10
