import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveVisualPreferences } from '../../src/theme/ui.ts';

describe('deriveVisualPreferences', () => {
  it('removes motion and makes translucent UI opaque when system preferences require it', () => {
    assert.deepEqual(deriveVisualPreferences(true, true), {
      reduceMotion: true,
      reduceTransparency: true,
      revealDuration: 0,
      surfaceMode: 'opaque',
    });
  });

  it('keeps restrained motion and glass surfaces by default', () => {
    assert.deepEqual(deriveVisualPreferences(false, false), {
      reduceMotion: false,
      reduceTransparency: false,
      revealDuration: 380,
      surfaceMode: 'glass',
    });
  });
});
