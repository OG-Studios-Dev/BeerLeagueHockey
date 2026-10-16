#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261016010000_leagues_timezone_not_null.sql"
POSITIVE="$ROOT/supabase/tests/leagues_timezone_not_null_acceptance.sql"
NULL_FIXTURE="$ROOT/supabase/tests/leagues_timezone_not_null_null_fixture.sql"
NULL_ASSERTION="$ROOT/supabase/tests/leagues_timezone_not_null_rejection_acceptance.sql"
PG_ROOT="${TMPDIR:-/tmp}/hockey-life-timezone-not-null-pg-$$"
PG_DATA="$PG_ROOT/data"
PG_LOG="$PG_ROOT/postgres.log"
NULL_FAILURE_LOG="$PG_ROOT/null-baseline-migration.log"
PG_HOST="127.0.0.1"
PORT="55438"
DB_NAME="timezone_not_null_acceptance"

mkdir -p "$PG_ROOT"
cleanup() {
  if [[ -d "$PG_DATA" ]]; then
    pg_ctl -D "$PG_DATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$PG_ROOT"
}
trap cleanup EXIT INT TERM

initdb -D "$PG_DATA" -A trust -U postgres --no-locale --encoding=UTF8 >/dev/null
if ! pg_ctl -D "$PG_DATA" -l "$PG_LOG" -o "-h $PG_HOST -p $PORT -F -c unix_socket_directories=''" start >/dev/null; then
  printf '%s\n' 'PostgreSQL failed to start:' >&2
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$PG_LOG"
  exit 1
fi

createdb -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME"
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PORT" -U postgres -d "$DB_NAME")

if [[ ! -f "$MIGRATION" ]]; then
  printf 'missing migration: %s\n' "$MIGRATION" >&2
  exit 1
fi

"${PSQL[@]}" -f "$POSITIVE"

dropdb -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME"
createdb -h "$PG_HOST" -p "$PORT" -U postgres "$DB_NAME"
"${PSQL[@]}" -f "$NULL_FIXTURE"

set +e
"${PSQL[@]}" -f "$MIGRATION" >"$NULL_FAILURE_LOG" 2>&1
migration_status=$?
set -e

if [[ "$migration_status" -eq 0 ]]; then
  printf '%s\n' 'NULL-bearing timezone baseline unexpectedly accepted' >&2
  exit 1
fi
if ! grep -q 'column "timezone" of relation "leagues" contains null values' "$NULL_FAILURE_LOG"; then
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done < "$NULL_FAILURE_LOG"
  printf '%s\n' 'NULL-bearing timezone baseline failed for an unexpected reason' >&2
  exit 1
fi

"${PSQL[@]}" -f "$NULL_ASSERTION"
printf '%s\n' 'leagues timezone NOT NULL prerequisite acceptance matrix passed (3 scenarios)'
