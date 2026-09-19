import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getDockAccessibilityVisuals, getMobileDockLayout } from '../../src/navigation/layout.ts';

describe('mobile dock responsive and accessibility layout', () => {
  it('retains 44pt controls and makes the build-16 crest art exactly 25% larger', () => {
    assert.deepEqual(getMobileDockLayout(390, 34, 844, 47), {
      outerHeight: 158,
      exteriorBottomOffset: 0,
      horizontalPadding: 8,
      safeAreaPaddingBottom: 34,
      touchMin: 44,
      crestSize: 112.5,
      crestArtSize: 102.5,
      teamColumnWidth: 120,
      topPadding: 42,
      tileColumns: 3,
      sheetMaxHeight: 711,
      compact: false,
    });
  });

  it('compacts the crest and grid without clipping on narrow, short screens', () => {
    const layout = getMobileDockLayout(320, 0, 568, 20);
    assert.deepEqual(layout, {
      outerHeight: 114,
      exteriorBottomOffset: 0,
      horizontalPadding: 4,
      safeAreaPaddingBottom: 6,
      touchMin: 44,
      crestSize: 97.5,
      crestArtSize: 87.5,
      teamColumnWidth: 104,
      topPadding: 34,
      tileColumns: 2,
      sheetMaxHeight: 496,
      compact: true,
    });
    const availableControlWidth = 320 - (layout.horizontalPadding * 2) - 2 /* dock borders; controls have no horizontal margins */;
    const sideControlWidth = (availableControlWidth - layout.teamColumnWidth) / 4;
    assert.ok(sideControlWidth >= layout.touchMin, `320px side controls resolve to ${sideControlWidth}px`);
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
