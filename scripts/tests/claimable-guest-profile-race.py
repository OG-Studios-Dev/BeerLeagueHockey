#!/usr/bin/env python3
"""Two-session PostgreSQL regression for guest/auth cross-table serialization."""

import argparse
import json
import os
import pathlib
import subprocess
import tempfile
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
PORT = "55501"
UID_GUEST_FIRST = "91000000-0000-4000-8000-000000000001"
UID_AUTH_FIRST = "91000000-0000-4000-8000-000000000002"
ENV = {**os.environ, "LC_ALL": "C", "LANG": "C"}


def run(args, *, data=None, check=True):
    result = subprocess.run(
        args, input=data, text=True, cwd=REPO, env=ENV,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if check and result.returncode:
        raise RuntimeError(result.stdout)
    return result


def wait_for(psql, query, expected="t", timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = run(psql + ["-Atc", query])
        if result.stdout.strip() == expected:
            return
        time.sleep(0.05)
    raise RuntimeError(f"barrier timeout: {query}")


def start_tx(psql, sql):
    process = subprocess.Popen(
        psql, cwd=REPO, env=ENV, text=True, stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    assert process.stdin is not None
    process.stdin.write(sql)
    process.stdin.close()
    return process


def finish(process):
    assert process.stdout is not None
    output = process.stdout.read()
    return process.wait(), output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--migration-ref")
    parser.add_argument("--expect-vulnerable", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()

    def emit(value):
        rendered = json.dumps(value, indent=2) + "\n"
        if args.output:
            pathlib.Path(args.output).write_text(rendered)
        print(rendered, end="")
    root = pathlib.Path(tempfile.mkdtemp(prefix="guest-race-", dir="/tmp"))
    pgdata = root / "data"
    psql = [
        "/opt/homebrew/bin/psql", "-X", "-h", str(root), "-p", PORT,
        "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
    ]
    evidence = {"cluster": str(root), "port": int(PORT), "orderings": []}
    try:
        run(["/opt/homebrew/bin/initdb", "-D", str(pgdata), "-U", "postgres", "-A", "trust", "--no-locale"])
        run([
            "/opt/homebrew/bin/pg_ctl", "-D", str(pgdata), "-l", str(root / "server.log"),
            "-o", f"-k {root} -p {PORT} -c listen_addresses=''", "-w", "start",
        ])
        run(psql + ["-f", "supabase/tests/claimable_guest_profiles_fixture_setup.sql"])
        if args.migration_ref:
            migration = run([
                "git", "show", f"{args.migration_ref}:supabase/migrations/20260930100000_claimable_guest_profile_provenance.sql",
            ]).stdout
            run(psql, data=migration)
        else:
            run(psql + ["-f", "supabase/migrations/20260930100000_claimable_guest_profile_provenance.sql"])
        run(psql, data=(
            "ALTER TABLE auth.users ADD COLUMN email text, "
            "ADD COLUMN raw_user_meta_data jsonb DEFAULT '{}';"
            "ALTER TABLE teams ADD COLUMN league_id uuid;"
            "CREATE TABLE team_invites(id uuid,team_id uuid,season_id uuid,email text,status text,"
            "expires_at timestamptz,accepted_by uuid,updated_at timestamptz);"
        ))
        run(psql + ["-f", "supabase/migrations/20260703030000_signup_no_auto_merge.sql"])
        run(psql, data="CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();")

        # Guest first: auth INSERT must wait on the guest lock, then reject after
        # the guest commits and becomes visible to the post-lock recheck.
        guest = start_tx(psql, f"BEGIN; SELECT set_config('request.jwt.claim.role','service_role',true); INSERT INTO profiles(id,email,role,is_legacy_import) VALUES ('{UID_GUEST_FIRST}','manual-spare+{UID_GUEST_FIRST}@beerleaguehockey.local','player',true); SELECT pg_sleep(2); COMMIT;")
        key = f"pg_catalog.hashtextextended('public.profile_auth_identity:{UID_GUEST_FIRST}',0)"
        if args.expect_vulnerable:
            wait_for(psql, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query LIKE '%pg_sleep(2)%' AND wait_event='PgSleep')")
        else:
            wait_for(psql, f"SELECT NOT pg_catalog.pg_try_advisory_xact_lock({key})")
        auth = start_tx(psql, f"INSERT INTO auth.users(id,email) VALUES ('{UID_GUEST_FIRST}','synthetic@example.invalid');")
        wait_for(psql, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event IS NOT NULL AND query LIKE 'INSERT INTO auth.users%')")
        guest_rc, guest_out = finish(guest)
        auth_rc, auth_out = finish(auth)
        row = run(psql + ["-Atc", f"SELECT identity_provenance || '|' || EXISTS(SELECT 1 FROM auth.users WHERE id='{UID_GUEST_FIRST}')::text FROM profiles WHERE id='{UID_GUEST_FIRST}'"]).stdout.strip()
        evidence["orderings"].append({"name": "guest_first", "wait_observed": True, "guest_exit": guest_rc, "auth_exit": auth_rc, "final": row, "auth_output": auth_out})
        if args.expect_vulnerable:
            if guest_rc != 0 or auth_rc != 0 or row != "claimable_guest|true":
                raise RuntimeError(json.dumps(evidence, indent=2))
            evidence["expected_vulnerability_reproduced"] = True
            emit(evidence)
            return
        if guest_rc != 0 or auth_rc == 0 or row != "claimable_guest|false":
            raise RuntimeError(json.dumps(evidence, indent=2))

        # Auth first: its real AFTER INSERT signup trigger re-enters the same lock
        # while creating the ordinary profile. The guest statement waits, then
        # fails on the existing canonical profile; no guest/auth pair is created.
        auth = start_tx(psql, f"BEGIN; INSERT INTO auth.users(id,email) VALUES ('{UID_AUTH_FIRST}','synthetic2@example.invalid'); SELECT pg_sleep(2); COMMIT;")
        key = f"pg_catalog.hashtextextended('public.profile_auth_identity:{UID_AUTH_FIRST}',0)"
        wait_for(psql, f"SELECT NOT pg_catalog.pg_try_advisory_xact_lock({key})")
        guest = start_tx(psql, f"SELECT set_config('request.jwt.claim.role','service_role',false); INSERT INTO profiles(id,email,role,is_legacy_import) VALUES ('{UID_AUTH_FIRST}','manual-spare+{UID_AUTH_FIRST}@beerleaguehockey.local','player',true);")
        wait_for(psql, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory')")
        auth_rc, auth_out = finish(auth)
        guest_rc, guest_out = finish(guest)
        row = run(psql + ["-Atc", f"SELECT identity_provenance || '|' || EXISTS(SELECT 1 FROM auth.users WHERE id='{UID_AUTH_FIRST}')::text FROM profiles WHERE id='{UID_AUTH_FIRST}'"]).stdout.strip()
        evidence["orderings"].append({"name": "auth_first", "wait_observed": True, "auth_exit": auth_rc, "guest_exit": guest_rc, "final": row, "guest_output": guest_out})
        if auth_rc != 0 or guest_rc == 0 or row != "auth_account|true":
            raise RuntimeError(json.dumps(evidence, indent=2))

        emit(evidence)
    finally:
        run(["/opt/homebrew/bin/pg_ctl", "-D", str(pgdata), "-m", "immediate", "-w", "stop"], check=False)


if __name__ == "__main__":
    main()
