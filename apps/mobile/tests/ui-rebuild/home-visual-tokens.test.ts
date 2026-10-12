import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness';

type LeagueVisualModule = {
  LEAGUE_VISUAL_TOKENS: {
    canvas: string;
    ink: string;
    navy: string;
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
  getLeagueVisualPreferences: (
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

const leagueVisuals = compileCommonJs<LeagueVisualModule>(
  new URL('../../src/theme/league.ts', import.meta.url),
  {},
);

describe('shared league visual tokens', () => {
  it('uses the accepted Home ink arena hierarchy as the mobile-wide source of truth', () => {
    assert.deepEqual(
      {
        canvas: leagueVisuals.LEAGUE_VISUAL_TOKENS.canvas,
        navy: leagueVisuals.LEAGUE_VISUAL_TOKENS.navy,
        ink: leagueVisuals.LEAGUE_VISUAL_TOKENS.ink,
        surfaceOpaque: leagueVisuals.LEAGUE_VISUAL_TOKENS.surfaceOpaque,
        text: leagueVisuals.LEAGUE_VISUAL_TOKENS.text,
        textSecondary: leagueVisuals.LEAGUE_VISUAL_TOKENS.textSecondary,
      },
      {
        canvas: '#07111F',
        navy: '#0A1628',
        ink: '#030A13',
        surfaceOpaque: '#0C1B31',
        text: '#F8FBFF',
        textSecondary: '#A9B8CC',
      },
    );
    assert.equal(leagueVisuals.LEAGUE_VISUAL_TOKENS.surface, 'rgba(10, 22, 40, 0.30)');
    assert.equal(leagueVisuals.LEAGUE_VISUAL_TOKENS.surfaceTop, 'rgba(12, 27, 49, 0.38)');
    assert.equal(leagueVisuals.LEAGUE_VISUAL_TOKENS.surfaceBottom, 'rgba(7, 17, 31, 0.24)');
    assert.equal(leagueVisuals.LEAGUE_VISUAL_TOKENS.stroke, 'rgba(125, 190, 255, 0.22)');
  });

  it('defines compact geometry and removes transparency and glow when requested', () => {
    assert.equal(leagueVisuals.LEAGUE_VISUAL_TOKENS.minTouchTarget, 44);
    assert.equal(leagueVisuals.LEAGUE_VISUAL_TOKENS.compactBreakpoint, 390);

    const accessible = leagueVisuals.getLeagueVisualPreferences(true, true);
    assert.equal(accessible.surface, leagueVisuals.LEAGUE_VISUAL_TOKENS.surfaceOpaque);
    assert.equal(accessible.elevated, leagueVisuals.LEAGUE_VISUAL_TOKENS.elevatedOpaque);
    assert.equal(accessible.stroke, '#41607F');
    assert.equal(accessible.surfaceTop, leagueVisuals.LEAGUE_VISUAL_TOKENS.surfaceOpaque);
    assert.equal(accessible.surfaceBottom, leagueVisuals.LEAGUE_VISUAL_TOKENS.elevatedOpaque);
    assert.equal(accessible.revealDuration, 0);
    assert.equal(accessible.showAtmosphericGlow, false);
  });
});
