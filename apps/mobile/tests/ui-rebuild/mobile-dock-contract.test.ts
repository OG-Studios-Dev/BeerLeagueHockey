import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const navigationSource = readFileSync(
  fileURLToPath(new URL('../../src/navigation/index.tsx', import.meta.url) as any),
  'utf8',
);
const dockSource = readFileSync(
  fileURLToPath(new URL('../../src/navigation/MobileWebDock.tsx', import.meta.url) as any),
  'utf8',
);

function readStringArray(exportName: string) {
  const match = navigationSource.match(
    new RegExp(`export const ${exportName} = \\[([\\s\\S]*?)\\] as const`),
  );
  return [...(match?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

describe('native web-style dock contract', () => {
  it('exposes exactly the requested five controls in the web visual order', () => {
    assert.deepEqual(readStringArray('VISIBLE_DOCK_CONTROLS'), [
      'Standings',
      'Schedule',
      'Team',
      'Stats',
      'More',
    ]);
    const controlsBlock = dockSource.match(/const CONTROLS = \[([\s\S]*?)\] as const/)?.[1] ?? '';
    assert.deepEqual([...controlsBlock.matchAll(/label:\s*['"]([^'"]+)['"]/g)].map((entry) => entry[1]), [
      'Standings', 'Schedule', 'Team', 'Stats', 'More',
    ]);
    assert.match(navigationSource, /tabBar=\{\(props\) => <MobileWebDock \{\.\.\.props\} \/>\}/);
  });

  it('carries the complete public web More catalog in the integrated navigation module', () => {
    assert.deepEqual(readStringArray('PUBLIC_MORE_PAGE_LABELS'), [
      'Teams',
      'Players',
      'Playoffs',
      'News',
      'History',
      'Gallery',
      'Events',
      'Venues',
      'About',
      'Contact',
    ]);
  });
});
