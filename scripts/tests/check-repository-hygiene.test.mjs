import assert from 'node:assert/strict';
import test from 'node:test';

import { findForbiddenPaths } from '../check-repository-hygiene.mjs';

test('rejects local worktrees and generated test artifacts', () => {
  const violations = findForbiddenPaths([
    '.claude/worktrees/duplicate/package.json',
    '.hermes/session.json',
    'e2e/test-results/results.json',
    'e2e/screenshots/failure.png',
    'scripts/tests/email.ts.bak',
  ]);

  assert.deepEqual(
    violations.map(({ path }) => path),
    [
      '.claude/worktrees/duplicate/package.json',
      '.hermes/session.json',
      'e2e/test-results/results.json',
      'e2e/screenshots/failure.png',
      'scripts/tests/email.ts.bak',
    ],
  );
});

test('allows source, fixtures, documentation, and archived evidence', () => {
  assert.deepEqual(
    findForbiddenPaths([
      'apps/mobile/src/index.ts',
      'e2e/fixtures/player.json',
      'docs/test-results-analysis.md',
      'scripts/archive/agent-worktree-patches/example.patch',
    ]),
    [],
  );
});
