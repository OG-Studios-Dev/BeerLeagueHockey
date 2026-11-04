import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getTabBarLayout } from '../../src/navigation/layout.ts';

describe('getTabBarLayout', () => {
  it('includes the device bottom inset while retaining 44pt tab targets', () => {
    assert.deepEqual(getTabBarLayout(34), {
      height: 92,
      paddingBottom: 34,
      paddingTop: 6,
      itemMinHeight: 44,
    });
  });

  it('provides comfortable padding on devices without a home indicator', () => {
    assert.deepEqual(getTabBarLayout(0), {
      height: 66,
      paddingBottom: 8,
      paddingTop: 6,
      itemMinHeight: 44,
    });
  });
});
