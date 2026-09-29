import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findForbiddenPaths } from '../check-repository-hygiene.mjs';

const sourceCli = fileURLToPath(new URL('../check-repository-hygiene.mjs', import.meta.url));
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function makeRepo() {
  const parent = mkdtempSync(join(tmpdir(), 'hygiene-cli-'));
  const root = join(parent, 'repo#fragment%encoded');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(sourceCli, join(root, 'scripts/check-repository-hygiene.mjs'));
  git(root, ['init', '-q']);
  return { root, cli: join(root, 'scripts/check-repository-hygiene.mjs') };
}

test('rejects local worktrees and generated test artifacts', () => {
  const violations = findForbiddenPaths([
    '.claude/worktrees/duplicate/package.json', '.claude/orchestration.log',
    '.hermes/session.json', 'e2e/test-results/results.json',
    'e2e/screenshots/failure.png', 'scripts/tests/email.ts.bak',
  ]);
  assert.deepEqual(violations.map(({ path }) => path), [
    '.claude/worktrees/duplicate/package.json', '.claude/orchestration.log',
    '.hermes/session.json', 'e2e/test-results/results.json',
    'e2e/screenshots/failure.png', 'scripts/tests/email.ts.bak',
  ]);
});

test('allows source, fixtures, documentation, and archived evidence', () => {
  assert.deepEqual(findForbiddenPaths([
    'apps/mobile/src/index.ts', 'e2e/fixtures/player.json',
    'docs/test-results-analysis.md', 'scripts/archive/agent-worktree-patches/example.patch',
  ]), []);
});

test('CLI checks the whole repo from root and subdirectories in # and % paths', () => {
  const { root, cli } = makeRepo();
  writeFileSync(join(root, 'README.md'), 'ok\n');
  git(root, ['add', 'README.md']);
  mkdirSync(join(root, 'apps/mobile'), { recursive: true });
  for (const cwd of [root, join(root, 'apps/mobile')]) {
    const result = spawnSync(process.execPath, [cli], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Repository hygiene check passed/);
  }
});

test('CLI rejects forbidden NUL-delimited names, orchestration log, and gitlinks from a subdirectory', () => {
  const { root, cli } = makeRepo();
  const files = ['.claude/orchestration.log', 'e2e/test-results/strange\nname.txt'];
  for (const path of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), 'forbidden\n');
  }
  git(root, ['add', '--', ...files]);
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},.claude/worktrees/gitlink`]);
  mkdirSync(join(root, 'nested'), { recursive: true });
  const result = spawnSync(process.execPath, [cli], { cwd: join(root, 'nested'), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.claude\/orchestration\.log/);
  assert.match(result.stderr, /\.claude\/worktrees\/gitlink/);
  assert.match(result.stderr, /e2e\/test-results\/strange\nname\.txt/);
});

test('CLI propagates git discovery failures', () => {
  const { cli } = makeRepo();
  const outside = mkdtempSync(join(tmpdir(), 'hygiene-outside-'));
  const result = spawnSync(process.execPath, [cli], { cwd: outside, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a git repository/);
});
