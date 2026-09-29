import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const detector = join(repoRoot, 'scripts/ci/detect-native-ios-changes.sh');
const mobileTests = [
  'apps/mobile/scripts/__tests__/testflight-readiness.test.cjs',
  'apps/mobile/scripts/__tests__/branding-contract.test.cjs',
  'apps/mobile/tests/ui-rebuild/branding-components.test.ts',
  'apps/mobile/tests/ui-rebuild/league-logo.test.ts',
  'apps/mobile/tests/ui-rebuild/league-content-client.test.ts',
  'apps/mobile/tests/ui-rebuild/league-content-model.test.ts',
  'apps/mobile/tests/ui-rebuild/league-content-runtime.test.ts',
];
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function commit(cwd, message) {
  git(cwd, ['add', '.']);
  git(cwd, ['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function runDetector(cwd, base, head) {
  const output = join(cwd, `github-output-${Math.random()}`);
  writeFileSync(output, '');
  const result = spawnSync('bash', [detector], {
    cwd, encoding: 'utf8',
    env: { ...process.env, BASE_SHA: base, GITHUB_SHA: head, GITHUB_OUTPUT: output },
  });
  return { ...result, output: readFileSync(output, 'utf8') };
}

test('workflow gates renderer by package, enforces all mobile tests, then always runs root tests', () => {
  const renderer = workflow.indexOf('- name: Run Hockey Life Times renderer tests');
  const requireMobile = workflow.indexOf('- name: Require the complete shipped mobile test suite');
  const runMobile = workflow.indexOf('- name: Run shipped mobile readiness and UI tests');
  const rootTests = workflow.indexOf('- name: Run tests', runMobile);
  assert.ok(renderer >= 0 && renderer < requireMobile && requireMobile < runMobile && runMobile < rootTests);
  assert.match(workflow.slice(renderer, requireMobile), /hashFiles\('packages\/hockey-life-times\/package\.json'\)/);
  assert.match(workflow.slice(requireMobile, runMobile), /github\.base_ref == 'release\/mobile-auth-env-fix'/);
  for (const path of mobileTests) {
    assert.ok(workflow.slice(requireMobile, runMobile).includes(path), `${path} must be required`);
    assert.ok(workflow.slice(runMobile, rootTests).includes(path), `${path} must be executed`);
  }
  assert.doesNotMatch(workflow, /continue-on-error/);
  const present = mobileTests.filter((path) => existsSync(join(repoRoot, path)));
  assert.ok(present.length === 0 || present.length === mobileTests.length, 'lineage must contain zero or all seven mobile tests');
});

test('native detector reports unchanged and changed histories using real git commits', () => {
  const repo = mkdtempSync(join(tmpdir(), 'native-detector-'));
  git(repo, ['init', '-q']);
  writeFileSync(join(repo, 'README.md'), 'one\n');
  const base = commit(repo, 'base');
  writeFileSync(join(repo, 'README.md'), 'two\n');
  const unchanged = commit(repo, 'web only');
  let result = runDetector(repo, base, unchanged);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'ios-native=false\n');
  mkdirSync(join(repo, 'apps/ios'), { recursive: true });
  writeFileSync(join(repo, 'apps/ios/project.yml'), 'name: Test\n');
  const changed = commit(repo, 'native');
  result = runDetector(repo, unchanged, changed);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'ios-native=true\n');
});

test('native detector fails closed for a missing base without writing an output', () => {
  const repo = mkdtempSync(join(tmpdir(), 'native-detector-missing-'));
  git(repo, ['init', '-q']);
  writeFileSync(join(repo, 'README.md'), 'one\n');
  const head = commit(repo, 'head');
  const result = runDetector(repo, '1'.repeat(40), head);
  assert.notEqual(result.status, 0);
  assert.equal(result.output, '');
  assert.match(result.stderr, /Invalid or missing base commit/);
});
