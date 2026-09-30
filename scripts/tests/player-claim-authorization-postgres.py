#!/usr/bin/env python3
"""Disposable PostgreSQL 17 acceptance for player claim authorization.

Use --red to prove the pre-migration anon takeover. Default mode applies the
forward migration and verifies role ACLs, invariants, preservation, invites,
owner guest compatibility, and a two-session race. No network/live project is
used; the server listens only on a unique Unix socket and is always stopped.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

PG_BIN = Path('/opt/homebrew/bin')
PORT = '55511'
ROOT = Path(__file__).resolve().parents[2]


def run(cmd: list[str], *, env: dict[str, str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT, env=env, text=True, capture_output=True, check=check)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--red', action='store_true', help='prove the vulnerable pre-migration behavior and exit nonzero')
    args = parser.parse_args()

    for binary in ('initdb', 'pg_ctl', 'createdb', 'psql'):
        if not (PG_BIN / binary).exists():
            raise SystemExit(f'missing PostgreSQL 17 binary: {PG_BIN / binary}')

    temp_root = Path(tempfile.mkdtemp(prefix='player-claim-auth-'))
    data_dir = temp_root / 'data'
    socket_dir = temp_root / 'socket'
    socket_dir.mkdir()
    env = os.environ.copy()
    env.update({'LC_ALL': 'C', 'LANG': 'C', 'PGHOST': str(socket_dir), 'PGPORT': PORT, 'PGDATABASE': 'claim_test', 'PGUSER': os.environ.get('USER', 'postgres')})
    started = False

    def psql(sql: str | None = None, file: Path | None = None, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        cmd = [str(PG_BIN / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At']
        if file is not None:
            cmd += ['-f', str(file)]
        if sql is not None:
            cmd += ['-c', sql]
        result = run(cmd, env=env, check=False)
        if check and result.returncode != 0:
            raise RuntimeError(f"psql failed ({result.returncode}): {result.stderr}\n{result.stdout}")
        return result

    try:
        run([str(PG_BIN / 'initdb'), '-D', str(data_dir), '--no-locale', '--encoding=UTF8', '--auth=trust'], env=env)
        run([
            str(PG_BIN / 'pg_ctl'), '-D', str(data_dir), '-o',
            f"-k {socket_dir} -p {PORT} -c listen_addresses=''", '-l', str(temp_root / 'postgres.log'), '-w', 'start'
        ], env=env)
        started = True
        run([str(PG_BIN / 'createdb'), '--maintenance-db=postgres', 'claim_test'], env=env)
        psql(file=ROOT / 'supabase/tests/player_claim_authorization_fixture.sql')
        psql(file=ROOT / 'supabase/migrations/20260703010000_merge_completeness_fix.sql')
        # Reproduce the fresh-live ACL baseline established by the earlier grant migration.
        psql(sql="""
          REVOKE ALL ON FUNCTION public._claim_update_uuid_column_if_exists(text,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
          GRANT EXECUTE ON FUNCTION public._claim_update_uuid_column_if_exists(text,text,uuid,uuid) TO service_role;
          REVOKE ALL ON FUNCTION public.claim_rostered_player_profile(uuid,uuid) FROM PUBLIC, anon, authenticated;
          GRANT EXECUTE ON FUNCTION public.claim_rostered_player_profile(uuid,uuid) TO service_role;
        """)

        if args.red:
            red = psql(sql="""
              SET ROLE anon;
              SELECT public.merge_legacy_profile(
                'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                '11111111-1111-1111-1111-111111111111'
              );
            """)
            result = json.loads(red.stdout.strip().splitlines()[-1])
            moved = psql(sql="SELECT count(*) FROM public.game_checkins WHERE id='10101010-1010-1010-1010-101010101010' AND player_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';").stdout.strip()
            source = psql(sql="SELECT count(*) FROM public.profiles WHERE id='11111111-1111-1111-1111-111111111111';").stdout.strip()
            if result.get('success') is True and moved == '1' and source == '0':
                print('RED CONFIRMED: anon moved sentinel and deleted source before migration')
                return 1
            raise AssertionError(f'expected vulnerable RED, got result={result}, moved={moved}, source={source}')

        psql(file=ROOT / 'supabase/migrations/20260930142000_player_claim_authorization.sql')

        # Actual SQL-role denials, including a spoofed request role GUC.
        denial_cases = {
            'anon raw merge': "SET ROLE anon; SELECT public.merge_legacy_profile('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'authenticated admin RPC': "SET ROLE authenticated; SELECT public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'ordinary authenticated owner admin RPC': "SET ROLE authenticated; SELECT public.admin_merge_legacy_profile('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'GUC spoof': "SET ROLE authenticated; SET request.jwt.claim.role='service_role'; SELECT public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'service raw helper': "SET ROLE service_role; SELECT public._claim_update_uuid_column_if_exists('game_checkins','player_id','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'anon invite read': "SET ROLE anon; SELECT count(*) FROM public.captain_player_invites;",
        }
        for label, statement in denial_cases.items():
            denied = psql(sql=statement, check=False)
            if denied.returncode == 0 or 'permission denied' not in denied.stderr.lower():
                raise AssertionError(f'{label} was not denied: stdout={denied.stdout} stderr={denied.stderr}')

        # A service-role call through the sole external RPC succeeds and preserves data.
        service = psql(sql="""
          SET ROLE service_role;
          SELECT public.admin_merge_legacy_profile(
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '44444444-4444-4444-4444-444444444444',
            '14141414-1414-1414-1414-141414141414'
          );
        """)
        service_result = json.loads(service.stdout.strip().splitlines()[-1])
        if service_result.get('success') is not True:
            raise AssertionError(f'valid service admin merge failed: {service_result}')
        preserved = psql(sql="SELECT count(*) FROM public.game_checkins WHERE id='21212121-2121-2121-2121-212121212121' AND player_id='44444444-4444-4444-4444-444444444444';").stdout.strip()
        if preserved != '1':
            raise AssertionError('valid service admin merge did not preserve representative record')

        psql(file=ROOT / 'supabase/tests/player_claim_authorization_acceptance.sql')

        # Race two authorized claims for the same source. The first holds its
        # transaction lock briefly so the second must serialize behind it.
        race_sql_a = """
          BEGIN; SET ROLE service_role;
          SELECT public.admin_merge_legacy_profile(
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '55555555-5555-5555-5555-555555555555',
            '13131313-1313-1313-1313-131313131313');
          SELECT pg_sleep(1); COMMIT;
        """
        race_sql_b = """
          BEGIN; SET ROLE service_role;
          SELECT public.admin_merge_legacy_profile(
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '66666666-6666-6666-6666-666666666666',
            '13131313-1313-1313-1313-131313131313');
          COMMIT;
        """
        proc_a = subprocess.Popen([str(PG_BIN / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', race_sql_a], cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(0.2)
        proc_b = subprocess.Popen([str(PG_BIN / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', race_sql_b], cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out_a, err_a = proc_a.communicate(timeout=15)
        out_b, err_b = proc_b.communicate(timeout=15)
        if proc_a.returncode or proc_b.returncode:
            raise AssertionError(f'race process failed: A={err_a} B={err_b}')
        race_results = []
        for output in (out_a, out_b):
            json_line = next(line for line in output.splitlines() if line.startswith('{'))
            race_results.append(json.loads(json_line))
        if sum(result.get('success') is True for result in race_results) != 1:
            raise AssertionError(f'race did not produce exactly one winner: {race_results}')
        race_state = psql(sql="""
          SELECT
            (SELECT count(*) FROM public.profiles WHERE id='13131313-1313-1313-1313-131313131313'),
            (SELECT player_id FROM public.game_checkins WHERE id='20202020-2020-2020-2020-202020202020'),
            (SELECT count(*) FROM public.profiles WHERE id IN ('55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666') AND legacy_merge_completed_at IS NOT NULL);
        """).stdout.strip()
        if not race_state.startswith('0|') or not race_state.endswith('|1'):
            raise AssertionError(f'race final state invalid: {race_state}')

        print('GREEN: player claim authorization PostgreSQL acceptance passed')
        return 0
    finally:
        if started:
            subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(data_dir), '-m', 'fast', '-w', 'stop'], env=env, text=True, capture_output=True)
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
