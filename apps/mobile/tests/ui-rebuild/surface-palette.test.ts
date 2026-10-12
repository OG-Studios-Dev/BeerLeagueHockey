import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSurfacePalette } from '../../src/theme/ui.ts';

describe('getSurfacePalette', () => {
  it('returns a readable solid fallback without transparent color values', () => {
    const palette = getSurfacePalette(true);

    assert.equal(palette.surface, '#0C1B31');
    assert.equal(palette.elevated, '#0A1628');
    assert.equal(Object.values(palette).every((value) => !value.startsWith('rgba')), true);
  });

  it('uses translucent slate surfaces when transparency is allowed', () => {
    assert.deepEqual(getSurfacePalette(false), {
      surface: 'rgba(10, 22, 40, 0.30)',
      elevated: 'rgba(12, 27, 49, 0.38)',
      interactive: 'rgba(7, 17, 31, 0.78)',
      stroke: 'rgba(125, 190, 255, 0.22)',
    });
  });
});
