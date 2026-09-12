import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getDockAccessibilityVisuals, getMobileDockLayout } from '../../src/navigation/layout.ts';

describe('mobile dock responsive and accessibility layout', () => {
  it('retains 44pt controls and the protruding web-scale crest with safe-area space', () => {
    assert.deepEqual(getMobileDockLayout(390, 34, 844, 47), {
      outerHeight: 138,
      horizontalPadding: 12,
      touchMin: 44,
      crestSize: 90,
      tileColumns: 3,
      sheetMaxHeight: 711,
      compact: false,
    });
  });

  it('compacts the crest and grid without clipping on narrow, short screens', () => {
    assert.deepEqual(getMobileDockLayout(320, 0, 568, 20), {
      outerHeight: 104,
      horizontalPadding: 8,
      touchMin: 44,
      crestSize: 78,
      tileColumns: 2,
      sheetMaxHeight: 496,
      compact: true,
    });
  });

  it('makes reduced motion instant and reduced transparency opaque', () => {
    assert.deepEqual(getDockAccessibilityVisuals(true, true), {
      animate: false,
      fadeSheet: false,
      glassGradient: false,
      opaqueSurface: true,
    });
  });
});
