#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 red|green postgresql://..." >&2
  exit 64
fi

mode=$1
database_url=$2
test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(CDPATH= cd -- "$test_dir/../.." && pwd)

psql "$database_url" -X -v ON_ERROR_STOP=1 -f "$test_dir/scorekeeping_reliability_fixture.sql"

case "$mode" in
  red)
    psql "$database_url" -X -v ON_ERROR_STOP=1 -f "$test_dir/scorekeeping_reliability_red.sql"
    ;;
  green)
    psql "$database_url" -X -v ON_ERROR_STOP=1 -f "$repo_dir/supabase/migrations/20260913000000_scorekeeping_write_reliability.sql"
    psql "$database_url" -X -v ON_ERROR_STOP=1 -f "$test_dir/scorekeeping_reliability_test.sql"
    ;;
  *)
    echo "mode must be red or green" >&2
    exit 64
    ;;
esac
