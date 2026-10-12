import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../src/${relative}`, import.meta.url)), 'utf8');

describe('Reduce Transparency surface ownership', () => {
  it('gives Standings cards a runtime opaque fallback instead of a static translucent token', () => {
    const source = read('screens/StandingsScreen.tsx');
    assert.match(source, /getSurfacePalette\(reduceTransparency\)/);
    assert.match(source, /styles\.card,\s*\{\s*backgroundColor:\s*surfaces\.surface,\s*borderColor:\s*surfaces\.stroke\s*\}/s);
  });

  it('keeps runtime-aware composites on opaque fallbacks without mutating arbitrary card children', () => {
    for (const relative of [
      'components/ScheduleConflictList.tsx',
      'components/TeamPositioningChart.tsx',
      'components/LeagueMarketplace.tsx',
    ]) {
      const source = read(relative);
      assert.match(source, /getSurfacePalette\(reduceTransparency\)/, relative);
    }

    const cardFocus = read('components/CardFocus.tsx');
    assert.doesNotMatch(cardFocus, /cloneElement|Children\.(?:map|forEach|toArray)/);
  });
});
