import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const forbidden = [
  {
    reason: 'local agent worktree',
    matches: (path) => path.startsWith('.claude/worktrees/'),
  },
  {
    reason: 'generated orchestration log',
    matches: (path) => path === '.claude/orchestration.log',
  },
  {
    reason: 'local Hermes state',
    matches: (path) => path.startsWith('.hermes/'),
  },
  {
    reason: 'generated Playwright result',
    matches: (path) => path.startsWith('e2e/test-results/'),
  },
  {
    reason: 'generated Playwright screenshot',
    matches: (path) => path.startsWith('e2e/screenshots/'),
  },
  {
    reason: 'local test-script backup',
    matches: (path) => path.startsWith('scripts/tests/') && path.endsWith('.bak'),
  },
];

export function findForbiddenPaths(paths) {
  return paths.flatMap((path) => {
    const rule = forbidden.find(({ matches }) => matches(path));
    return rule ? [{ path, reason: rule.reason }] : [];
  });
}

export function trackedPaths(cwd = process.cwd()) {
  return execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function main() {
  const violations = findForbiddenPaths(trackedPaths());
  if (violations.length === 0) {
    console.log('Repository hygiene check passed: no forbidden generated artifacts are tracked.');
    return;
  }

  console.error('Repository hygiene check failed. Remove these tracked local/generated artifacts:');
  for (const { path, reason } of violations) {
    console.error(`- ${path} (${reason})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  main();
}
