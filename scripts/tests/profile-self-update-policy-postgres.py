#!/usr/bin/env python3
"""Disposable PostgreSQL regression for recursive profile self-update policy."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG_BIN = Path('/opt/homebrew/bin')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--red', action='store_true')
    args = parser.parse_args()
    temp_root = Path(tempfile.mkdtemp(prefix='profile-self-update-'))
    data = temp_root / 'data'
    socket = temp_root / 'socket'
    socket.mkdir()
    env = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C', 'PGHOST': str(socket),
           'PGPORT': '55513', 'PGDATABASE': 'policy_test',
           'PGUSER': os.environ.get('USER', 'postgres')}
    started = False

    def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(cmd, cwd=ROOT, env=env, text=True,
                              capture_output=True, check=check)

    def psql(sql: str | None = None, file: Path | None = None,
             check: bool = True) -> subprocess.CompletedProcess[str]:
        cmd = [str(PG_BIN / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At']
        if file:
            cmd += ['-f', str(file)]
        if sql:
            cmd += ['-c', sql]
        return run(cmd, check=check)

    try:
        run([str(PG_BIN / 'initdb'), '-D', str(data), '--no-locale',
             '--encoding=UTF8', '--auth=trust'])
        run([str(PG_BIN / 'pg_ctl'), '-D', str(data), '-o',
             f"-k {socket} -p 55513 -c listen_addresses=''", '-l',
             str(temp_root / 'postgres.log'), '-w', 'start'])
        started = True
        run([str(PG_BIN / 'createdb'), '--maintenance-db=postgres', 'policy_test'])
        psql(file=ROOT / 'supabase/tests/player_claim_authorization_fixture.sql')
        psql(file=ROOT / 'supabase/migrations/20260703010000_merge_completeness_fix.sql')
        psql(file=ROOT / 'supabase/migrations/20260930142000_player_claim_authorization.sql')

        # Exact captured production trigger and recursive UPDATE policy.
        psql(file=ROOT / 'supabase/migrations/20260304000001_protect_platform_admin_flag.sql')
        psql(sql="""
          DROP TRIGGER guard_platform_admin_escalation ON public.profiles;
          CREATE TRIGGER guard_platform_admin_escalation
            BEFORE UPDATE OF is_platform_admin ON public.profiles
            FOR EACH ROW EXECUTE FUNCTION public.prevent_platform_admin_self_escalation();
        """)

        statement = """
          SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
          SET ROLE authenticated;
          UPDATE public.profiles
             SET full_name='Normal Edit',
                 pending_legacy_match_ids=ARRAY['04040404-0404-0404-0404-040404040404'::uuid]
           WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
        """
        if args.red:
            result = psql(sql=statement, check=False)
            if result.returncode != 0 and '42P17' in result.stderr and 'infinite recursion' in result.stderr:
                print(result.stderr.strip())
                print('RED CONFIRMED: normal authenticated profile self-update fails with 42P17')
                return 1
            raise AssertionError(f'expected 42P17 recursion, got {result.returncode}: {result.stdout} {result.stderr}')

        psql(file=ROOT / 'supabase/migrations/20260930170000_profile_self_update_policy.sql')
        psql(sql=statement)
        state = psql(sql="SELECT full_name, cardinality(pending_legacy_match_ids) FROM public.profiles WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';").stdout.strip()
        assert state == 'Normal Edit|1', state

        checks = psql(sql="""
          SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
          SET ROLE authenticated; SELECT public.profile_self_is_platform_admin(); RESET ROLE;
          SET request.jwt.claim.sub='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
          SET ROLE authenticated; SELECT public.profile_self_is_platform_admin(); RESET ROLE;
        """).stdout.strip().splitlines()
        assert [line for line in checks if line in ('t', 'f')] == ['f', 't'], checks

        psql(sql="SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET ROLE authenticated; UPDATE public.profiles SET is_platform_admin=false WHERE id=auth.uid();")

        for label, sql in {
            'anon helper': "SET ROLE anon; SELECT public.profile_self_is_platform_admin();",
            'self elevate': "SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET ROLE authenticated; UPDATE public.profiles SET is_platform_admin=true WHERE id=auth.uid();",
            'self demote': "SET request.jwt.claim.sub='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; SET ROLE authenticated; UPDATE public.profiles SET is_platform_admin=false WHERE id=auth.uid();",
            'binding': "SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET ROLE authenticated; UPDATE public.profiles SET legacy_player_id='04040404-0404-0404-0404-040404040404' WHERE id=auth.uid();",
            'spoofed binding': "SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET request.jwt.claim.role='service_role'; SET ROLE authenticated; UPDATE public.profiles SET legacy_merge_completed_at=now() WHERE id=auth.uid();",
        }.items():
            result = psql(sql=sql, check=False)
            if result.returncode == 0:
                raise AssertionError(f'{label} unexpectedly succeeded')

        other = psql(sql="SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET ROLE authenticated; UPDATE public.profiles SET full_name='Other' WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc';").stdout
        assert 'UPDATE 0' in other, other

        # Service role can invoke and perform maintenance; function owner retains implicit execution.
        psql(sql="SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET ROLE service_role; SELECT public.profile_self_is_platform_admin(); RESET ROLE; SET request.jwt.claim.sub=''; SET ROLE service_role; UPDATE public.profiles SET is_platform_admin=true WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; RESET ROLE; SELECT public.profile_self_is_platform_admin(); UPDATE public.profiles SET is_platform_admin=false WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';")
        print('GREEN: recursive policy repaired; self edits, ACLs, admin guard, binding guard, and maintenance verified')
        return 0
    finally:
        if started:
            subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(data), '-m', 'fast',
                            '-w', 'stop'], env=env, text=True, capture_output=True)
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
