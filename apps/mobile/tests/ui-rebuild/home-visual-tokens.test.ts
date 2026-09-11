import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness';

type HomeVisualModule = {
  HOME_VISUAL_TOKENS: {
    canvas: string;
    ink: string;
    surface: string;
    surfaceTop: string;
    surfaceBottom: string;
    surfaceOpaque: string;
    elevated: string;
    elevatedOpaque: string;
    stroke: string;
    strokeOpaque: string;
    text: string;
    textSecondary: string;
    textMuted: string;
    minTouchTarget: number;
    compactBreakpoint: number;
  };
  getHomeVisualPreferences: (
    reduceTransparency: boolean,
    reduceMotion: boolean,
  ) => {
    canvas: string;
    surface: string;
    elevated: string;
    stroke: string;
    revealDuration: number;
    showAtmosphericGlow: boolean;
    surfaceTop: string;
    surfaceBottom: string;
  };
};

const homeVisuals = compileCommonJs<HomeVisualModule>(
  new URL('../../src/theme/home.ts', import.meta.url),
  {},
);

describe('Home-only pinned web visual tokens', () => {
  it('uses the pinned ink arena hierarchy without a blue-neon surface', () => {
    assert.deepEqual(
      {
        canvas: homeVisuals.HOME_VISUAL_TOKENS.canvas,
        ink: homeVisuals.HOME_VISUAL_TOKENS.ink,
        surfaceOpaque: homeVisuals.HOME_VISUAL_TOKENS.surfaceOpaque,
        text: homeVisuals.HOME_VISUAL_TOKENS.text,
        textSecondary: homeVisuals.HOME_VISUAL_TOKENS.textSecondary,
      },
      {
        canvas: '#07111F',
        ink: '#030A13',
        surfaceOpaque: '#0C1B31',
        text: '#F8FBFF',
        textSecondary: '#A9B8CC',
      },
    );
    assert.equal(homeVisuals.HOME_VISUAL_TOKENS.surface, 'rgba(10, 22, 40, 0.30)');
    assert.equal(homeVisuals.HOME_VISUAL_TOKENS.surfaceTop, 'rgba(12, 27, 49, 0.38)');
    assert.equal(homeVisuals.HOME_VISUAL_TOKENS.surfaceBottom, 'rgba(7, 17, 31, 0.24)');
    assert.equal(homeVisuals.HOME_VISUAL_TOKENS.stroke, 'rgba(125, 190, 255, 0.22)');
  });

  it('defines compact native geometry and removes transparency and motion when requested', () => {
    assert.equal(homeVisuals.HOME_VISUAL_TOKENS.minTouchTarget, 44);
    assert.equal(homeVisuals.HOME_VISUAL_TOKENS.compactBreakpoint, 390);

    const accessible = homeVisuals.getHomeVisualPreferences(true, true);
    assert.equal(accessible.surface, homeVisuals.HOME_VISUAL_TOKENS.surfaceOpaque);
    assert.equal(accessible.elevated, homeVisuals.HOME_VISUAL_TOKENS.elevatedOpaque);
    assert.equal(accessible.stroke, '#41607F');
    assert.equal(accessible.surfaceTop, homeVisuals.HOME_VISUAL_TOKENS.surfaceOpaque);
    assert.equal(accessible.surfaceBottom, homeVisuals.HOME_VISUAL_TOKENS.elevatedOpaque);
    assert.equal(accessible.revealDuration, 0);
    assert.equal(accessible.showAtmosphericGlow, false);
  });
});
