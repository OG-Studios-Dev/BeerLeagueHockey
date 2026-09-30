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
            psql(sql="""
              INSERT INTO auth.users(id) VALUES ('05050505-0505-0505-0505-050505050505');
              SET request.jwt.claim.sub='05050505-0505-0505-0505-050505050505';
              SET ROLE authenticated;
              INSERT INTO public.profiles(id, full_name)
              VALUES ('05050505-0505-0505-0505-050505050505', 'Exact Name Match');
              RESET ROLE;

              SET ROLE anon;
              SELECT public.match_legacy_player_to_profile(
                '02020202-0202-0202-0202-020202020202',
                'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
              );
              RESET ROLE;

              SET request.jwt.claim.sub='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
              SET ROLE authenticated;
              UPDATE public.legacy_players
              SET matched_to_profile_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
              WHERE id='03030303-0303-0303-0303-030303030303';
              RESET ROLE;

              SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
              SET ROLE authenticated;
              UPDATE public.profiles
              SET legacy_player_id='04040404-0404-0404-0404-040404040404',
                  legacy_merge_completed_at=now()
              WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
              RESET ROLE;
            """)
            red_state = psql(sql="""
              SELECT
                (SELECT matched_to_profile_id FROM public.legacy_players WHERE id='01010101-0101-0101-0101-010101010101'),
                (SELECT matched_to_profile_id FROM public.legacy_players WHERE id='02020202-0202-0202-0202-020202020202'),
                (SELECT matched_to_profile_id FROM public.legacy_players WHERE id='03030303-0303-0303-0303-030303030303'),
                (SELECT legacy_player_id FROM public.profiles WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
            """).stdout.strip()
            expected = (
                '05050505-0505-0505-0505-050505050505|'
                'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb|'
                'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee|'
                '04040404-0404-0404-0404-040404040404'
            )
            if red_state == expected:
                print('RED CONFIRMED: exact live trigger/RPC/owner-policy/profile-self-write routes all persisted bindings')
                return 1
            raise AssertionError(f'expected all four vulnerable binding routes, got {red_state}')

        psql(file=ROOT / 'supabase/migrations/20260930142000_player_claim_authorization.sql')

        # New profile creation no longer binds history by name.
        psql(sql="""
          INSERT INTO auth.users(id) VALUES ('05050505-0505-0505-0505-050505050505');
          SET request.jwt.claim.sub='05050505-0505-0505-0505-050505050505';
          SET ROLE authenticated;
          INSERT INTO public.profiles(id, full_name)
          VALUES ('05050505-0505-0505-0505-050505050505', 'Exact Name Match');
          RESET ROLE;
        """)
        automatic_binding = psql(sql="SELECT matched_to_profile_id IS NULL FROM public.legacy_players WHERE id='01010101-0101-0101-0101-010101010101';").stdout.strip()
        if automatic_binding != 't':
            raise AssertionError('profile creation still auto-bound legacy history by name')

        # Actual SQL-role denials, including a spoofed request role GUC.
        denial_cases = {
            'anon raw merge': "SET ROLE anon; SELECT public.merge_legacy_profile('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'authenticated admin RPC': "SET ROLE authenticated; SELECT public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'ordinary authenticated owner admin RPC': "SET ROLE authenticated; SELECT public.admin_merge_legacy_profile('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'GUC spoof': "SET ROLE authenticated; SET request.jwt.claim.role='service_role'; SELECT public.admin_merge_legacy_profile('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'service raw helper': "SET ROLE service_role; SELECT public._claim_update_uuid_column_if_exists('game_checkins','player_id','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111');",
            'anon invite read': "SET ROLE anon; SELECT count(*) FROM public.captain_player_invites;",
            'anon legacy match RPC': "SET ROLE anon; SELECT public.match_legacy_player_to_profile('02020202-0202-0202-0202-020202020202','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');",
            'service legacy match RPC': "SET ROLE service_role; SELECT public.match_legacy_player_to_profile('02020202-0202-0202-0202-020202020202','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');",
            'owner-role legacy table write': "SET request.jwt.claim.sub='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'; SET ROLE authenticated; UPDATE public.legacy_players SET matched_to_profile_id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' WHERE id='03030303-0303-0303-0303-030303030303';",
            'self profile binding update': "SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET ROLE authenticated; UPDATE public.profiles SET legacy_player_id='04040404-0404-0404-0404-040404040404' WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';",
            'JWT-spoofed self binding update': "SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; SET request.jwt.claim.role='service_role'; SET ROLE authenticated; UPDATE public.profiles SET legacy_merge_completed_at=now() WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';",
            'self profile binding insert': "INSERT INTO auth.users(id) VALUES ('06060606-0606-0606-0606-060606060606'); SET request.jwt.claim.sub='06060606-0606-0606-0606-060606060606'; SET ROLE authenticated; INSERT INTO public.profiles(id, full_name, legacy_player_id) VALUES ('06060606-0606-0606-0606-060606060606','Unsafe Insert','04040404-0404-0404-0404-040404040404');",
        }
        for label, statement in denial_cases.items():
            denied = psql(sql=statement, check=False)
            denial_text = denied.stderr.lower()
            if denied.returncode == 0 or not (
                'permission denied' in denial_text
                or 'requires a trusted operation' in denial_text
            ):
                raise AssertionError(f'{label} was not denied: stdout={denied.stdout} stderr={denied.stderr}')

        # Ordinary profile edits and non-authoritative pending hints still work.
        psql(sql="""
          SET request.jwt.claim.sub='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
          SET ROLE authenticated;
          UPDATE public.profiles
          SET full_name='Normal Edit',
              pending_legacy_match_ids=ARRAY['04040404-0404-0404-0404-040404040404'::uuid],
              legacy_player_id=legacy_player_id,
              legacy_merge_completed_at=legacy_merge_completed_at
          WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
          RESET ROLE;
        """)
        normal_edit = psql(sql="SELECT full_name, cardinality(pending_legacy_match_ids), legacy_player_id IS NULL, legacy_merge_completed_at IS NULL FROM public.profiles WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';").stdout.strip()
        if normal_edit != 'Normal Edit|1|t|t':
            raise AssertionError(f'normal profile edit/pending hint compatibility failed: {normal_edit}')

        # Trusted spare/guest creation remains compatible and cannot name-bind.
        psql(sql="""
          SET ROLE service_role;
          INSERT INTO public.profiles(id, full_name, is_legacy_import, identity_provenance)
          VALUES (
            '07070707-0707-0707-0707-070707070707',
            'Exact Name Match', false, 'claimable_guest'
          );
          RESET ROLE;
        """)
        public_read = psql(sql="SET ROLE anon; SELECT count(*) FROM public.legacy_players;").stdout.strip().splitlines()[-1]
        if public_read != '4':
            raise AssertionError(f'public legacy read compatibility failed: {public_read}')

        # Trusted service writes remain available for reviewed import/merge work.
        psql(sql="""
          SET ROLE service_role;
          UPDATE public.legacy_players
          SET matched_to_profile_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', matched_at=now()
          WHERE id='04040404-0404-0404-0404-040404040404';
          RESET ROLE;
        """)

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
        print('PASS: same-source race produced exactly one winner', json.dumps(race_results))

        # Actor == target with distinct sources must serialize without a
        # SHARE-to-UPDATE upgrade deadlock. Hold the shared target identity
        # advisory lock until both real caller sessions are observed waiting.
        psql(sql="""
          INSERT INTO public.profiles(id, is_legacy_import, identity_provenance) VALUES
            ('15151515-1515-1515-1515-151515151515', true, 'auth_account'),
            ('16161616-1616-1616-1616-161616161616', true, 'auth_account');
        """)
        target = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        distinct_sources = (
            '15151515-1515-1515-1515-151515151515',
            '16161616-1616-1616-1616-161616161616',
        )
        target_lock = (
            "BEGIN; SELECT pg_advisory_xact_lock("
            f"hashtextextended('public.profile_auth_identity:' || '{target}', 0)); "
            "SELECT pg_sleep(2); COMMIT;"
        )
        holder = subprocess.Popen(
            [str(PG_BIN / 'psql'), '-X', '-At', '-c', target_lock], cwd=ROOT,
            env={**env, 'PGAPPNAME': 'distinct-target-holder'}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        for _ in range(50):
            if psql(sql="SELECT count(*) FROM pg_stat_activity WHERE application_name='distinct-target-holder' AND wait_event='PgSleep';").stdout.strip() == '1':
                break
            time.sleep(0.02)
        else:
            raise AssertionError('distinct-source target lock holder never became ready')

        distinct_callers = []
        for index, source in enumerate(distinct_sources, start=1):
            statement = (
                "BEGIN; SET ROLE service_role; "
                f"SELECT public.admin_merge_legacy_profile('{target}','{target}','{source}'); "
                "ROLLBACK;"
            )
            distinct_callers.append(subprocess.Popen(
                [str(PG_BIN / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', statement],
                cwd=ROOT, env={**env, 'PGAPPNAME': f'distinct-claim-{index}'}, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            ))
        for _ in range(50):
            waiting = psql(sql="SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'distinct-claim-%' AND wait_event='advisory';").stdout.strip()
            if waiting == '2':
                break
            time.sleep(0.02)
        else:
            raise AssertionError(f'distinct-source callers did not both reach advisory barrier: {waiting}')

        distinct_results = []
        for proc in distinct_callers:
            output, error = proc.communicate(timeout=15)
            if proc.returncode:
                raise AssertionError(f'distinct-source process failed: {error}')
            distinct_results.append(json.loads(next(line for line in output.splitlines() if line.startswith('{'))))
        holder.communicate(timeout=15)
        if not all(result.get('success') is True for result in distinct_results):
            raise AssertionError(f'distinct-source actor-target claims did not both succeed: {distinct_results}')
        print('PASS: actor-target distinct-source callers both succeeded after advisory wait barrier', json.dumps(distinct_results))

        # An owner wrapper already holding the identity locks must never wait
        # behind an admin-held invite lock. A profile-row barrier creates the
        # overlap and pg_stat_activity proves both wait points were reached.
        ordering_target = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
        ordering_source = '17171717-1717-1717-1717-171717171717'
        psql(sql=f"""
          INSERT INTO public.profiles(id, is_legacy_import, identity_provenance)
          VALUES ('{ordering_source}', true, 'auth_account');
          INSERT INTO public.captain_player_invites(
            id, league_id, season_id, team_id, target_player_id, registration_path
          ) VALUES (
            '43434343-4343-4343-4343-434343434343',
            '53535353-5353-5353-5353-535353535353',
            '63636363-6363-6363-6363-636363636363',
            '73737373-7373-7373-7373-737373737373',
            '{ordering_source}', '/ordering'
          );
        """)
        profile_holder = subprocess.Popen(
            [str(PG_BIN / 'psql'), '-X', '-At', '-c',
             f"BEGIN; SELECT id FROM public.profiles WHERE id='{ordering_target}' FOR UPDATE; SELECT pg_sleep(2); COMMIT;"],
            cwd=ROOT, env={**env, 'PGAPPNAME': 'ordering-profile-holder'}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        for _ in range(50):
            if psql(sql="SELECT count(*) FROM pg_stat_activity WHERE application_name='ordering-profile-holder' AND wait_event='PgSleep';").stdout.strip() == '1':
                break
            time.sleep(0.02)
        else:
            raise AssertionError('ordering profile holder never became ready')

        owner = subprocess.Popen(
            [str(PG_BIN / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c',
             f"BEGIN; SELECT public.merge_legacy_profile('{ordering_target}','{ordering_source}'); COMMIT;"],
            cwd=ROOT, env={**env, 'PGAPPNAME': 'ordering-owner-wrapper'}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        for _ in range(50):
            owner_wait = psql(sql="SELECT wait_event FROM pg_stat_activity WHERE application_name='ordering-owner-wrapper';").stdout.strip()
            if owner_wait in ('transactionid', 'tuple'):
                break
            time.sleep(0.02)
        else:
            raise AssertionError(f'owner wrapper did not reach profile-row barrier: {owner_wait}')

        admin = subprocess.Popen(
            [str(PG_BIN / 'psql'), '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c',
             f"BEGIN; SET ROLE service_role; SELECT public.admin_merge_legacy_profile('{target}','{ordering_target}','{ordering_source}'); COMMIT;"],
            cwd=ROOT, env={**env, 'PGAPPNAME': 'ordering-admin-wrapper'}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        for _ in range(50):
            admin_wait = psql(sql="SELECT wait_event FROM pg_stat_activity WHERE application_name='ordering-admin-wrapper';").stdout.strip()
            if admin_wait == 'advisory':
                break
            time.sleep(0.02)
        else:
            raise AssertionError(f'admin wrapper did not reach identity barrier: {admin_wait}')

        owner_out, owner_err = owner.communicate(timeout=15)
        admin_out, admin_err = admin.communicate(timeout=15)
        profile_holder.communicate(timeout=15)
        if owner.returncode or admin.returncode:
            raise AssertionError(f'ordering process failed: owner={owner_err} admin={admin_err}')
        ordering_results = [
            json.loads(next(line for line in output.splitlines() if line.startswith('{')))
            for output in (owner_out, admin_out)
        ]
        if any('deadlock detected' in result.get('error', '') for result in ordering_results):
            raise AssertionError(f'owner/admin invite ordering deadlocked: {ordering_results}')
        if sum(result.get('success') is True for result in ordering_results) != 1:
            raise AssertionError(f'owner/admin same-source ordering did not produce one winner: {ordering_results}')
        print('PASS: owner/admin invite ordering avoided deadlock with one winner', json.dumps(ordering_results))

        print('GREEN: player claim authorization PostgreSQL acceptance passed')
        return 0
    finally:
        if started:
            subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(data_dir), '-m', 'fast', '-w', 'stop'], env=env, text=True, capture_output=True)
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == '__main__':
    raise SystemExit(main())
