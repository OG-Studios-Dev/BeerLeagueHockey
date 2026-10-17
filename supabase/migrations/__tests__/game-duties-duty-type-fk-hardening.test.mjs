import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const hardeningPath = resolve(
  root,
  'supabase/migrations/20261016015000_game_duties_duty_type_fk_no_action.sql',
);
const beerGuyPath = resolve(
  root,
  'supabase/migrations/20261016020000_beer_guy_authority.sql',
);
const fixturePath = resolve(root, 'supabase/tests/beer_guy_fixture.sql');
const runnerPath = resolve(root, 'supabase/tests/run_beer_guy_acceptance.sh');

const hardening = readFileSync(hardeningPath, 'utf8');
const beerGuy = readFileSync(beerGuyPath, 'utf8');
const fixture = readFileSync(fixturePath, 'utf8');
const runner = readFileSync(runnerPath, 'utf8');

test('orders the one-edge hardening strictly between prerequisite and Beer Guy', () => {
  assert.ok('20261016010000' < '20261016015000');
  assert.ok('20261016015000' < '20261016020000');
  assert.match(runner, /20261016010000_leagues_timezone_not_null\.sql/);
  assert.match(runner, /20261016015000_game_duties_duty_type_fk_no_action\.sql/);
  assert.match(runner, /20261016020000_beer_guy_authority\.sql/);
});

test('hardening is transactional, data-preserving, and scoped to one named FK', () => {
  assert.match(hardening, /^BEGIN;\n/);
  assert.match(hardening, /\nCOMMIT;\n$/);
  assert.doesNotMatch(hardening, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\s/mi);
  assert.equal(
    [...hardening.matchAll(/ALTER TABLE public\.game_duties/g)].length,
    1,
  );
  assert.match(
    hardening,
    /DROP CONSTRAINT game_duties_duty_type_id_fkey,[\s\S]*ADD CONSTRAINT game_duties_duty_type_id_fkey/,
  );
  assert.match(
    hardening,
    /FOREIGN KEY \(duty_type_id\)[\s\S]*REFERENCES public\.duty_types\(id\)[\s\S]*ON DELETE NO ACTION/,
  );
});

test('hardening fails closed except for exact CASCADE and already-applied NO ACTION shapes', () => {
  for (const fragment of [
    "v_edge_count <> 1",
    "v_constraint.contype <> 'f'",
    'NOT v_constraint.convalidated',
    'v_constraint.condeferrable',
    'v_constraint.condeferred',
    "v_constraint.confmatchtype <> 's'",
    "v_constraint.confupdtype <> 'a'",
    "v_constraint.confdeltype NOT IN ('a', 'c')",
  ]) {
    assert.ok(hardening.includes(fragment), `missing fail-closed check: ${fragment}`);
  }
  assert.match(hardening, /IF v_constraint\.confdeltype = 'c' THEN/);
  assert.match(hardening, /con\.convalidated/);
  assert.match(hardening, /NOT con\.condeferrable/);
  assert.match(hardening, /con\.confdeltype = 'a'/);
});

test('Beer Guy preflight requires the exact 16 CASCADE, 1 NO ACTION, 1 SET NULL matrix', () => {
  const start = beerGuy.indexOf("('teams', 'league_id', 'leagues'");
  const end = beerGuy.indexOf(
    ') AS required(source_table, source_column, target_table, delete_action)',
    start,
  );
  assert.ok(start >= 0 && end > start, 'required FK matrix not found');
  const matrix = beerGuy.slice(start, end);
  assert.equal([...matrix.matchAll(/'c'::"char"/g)].length, 16);
  assert.equal([...matrix.matchAll(/'a'::"char"/g)].length, 1);
  assert.equal([...matrix.matchAll(/'n'::"char"/g)].length, 1);
  assert.match(
    matrix,
    /\('game_duties', 'duty_type_id', 'duty_types', 'a'::"char"\)/,
  );
  assert.match(
    matrix,
    /\('game_duties', 'assigned_player_id', 'profiles', 'n'::"char"\)/,
  );
});

test('fixture models the post-hardening production actions explicitly', () => {
  const required = [
    /league_id uuid NOT NULL REFERENCES public\.leagues\(id\) ON DELETE CASCADE/,
    /season_id uuid NOT NULL REFERENCES public\.seasons\(id\) ON DELETE CASCADE/,
    /home_team_id uuid NOT NULL REFERENCES public\.teams\(id\) ON DELETE CASCADE/,
    /away_team_id uuid NOT NULL REFERENCES public\.teams\(id\) ON DELETE CASCADE/,
    /game_id uuid NOT NULL REFERENCES public\.games\(id\) ON DELETE CASCADE/,
    /duty_type_id uuid NOT NULL REFERENCES public\.duty_types\(id\) ON DELETE NO ACTION/,
    /assigned_player_id uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL/,
  ];
  for (const pattern of required) assert.match(fixture, pattern);
});

test('Beer Guy runner applies hardening before every Beer Guy migration path', () => {
  assert.equal(
    [...runner.matchAll(/apply_fk_hardening_migration/g)].length,
    4,
  );
  assert.match(
    runner,
    /apply_prerequisite_migration\n\s+apply_fk_hardening_migration[\s\S]{0,300}"\$\{PSQL\[@\]\}" -f "\$MIGRATION"/,
  );
});
