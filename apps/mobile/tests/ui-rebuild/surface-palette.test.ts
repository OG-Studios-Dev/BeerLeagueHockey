import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSurfacePalette } from '../../src/theme/ui.ts';

describe('getSurfacePalette', () => {
  it('returns a readable solid fallback without transparent color values', () => {
    const palette = getSurfacePalette(true);

    assert.equal(palette.surface, '#111E32');
    assert.equal(palette.elevated, '#0C1B31');
    assert.equal(Object.values(palette).every((value) => !value.startsWith('rgba')), true);
  });

  it('uses translucent slate surfaces when transparency is allowed', () => {
    assert.equal(getSurfacePalette(false).surface, 'rgba(12, 27, 49, 0.72)');
  });
});
