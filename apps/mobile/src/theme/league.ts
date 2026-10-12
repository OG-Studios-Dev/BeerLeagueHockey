/**
 * Shared mobile visual foundation, promoted from the accepted league Home design.
 */
export const LEAGUE_VISUAL_TOKENS = {
  canvas: '#07111F',
  ink: '#030A13',
  navy: '#0A1628',
  surface: 'rgba(10, 22, 40, 0.30)',
  surfaceTop: 'rgba(12, 27, 49, 0.38)',
  surfaceBottom: 'rgba(7, 17, 31, 0.24)',
  surfaceOpaque: '#0C1B31',
  elevated: 'rgba(12, 27, 49, 0.38)',
  elevatedOpaque: '#0A1628',
  control: 'rgba(7, 17, 31, 0.78)',
  stroke: 'rgba(125, 190, 255, 0.22)',
  strokeOpaque: '#41607F',
  rinkLine: 'rgba(255, 255, 255, 0.08)',
  highlight: 'rgba(255, 255, 255, 0.12)',
  text: '#F8FBFF',
  textSecondary: '#A9B8CC',
  textMuted: '#8293AA',
  success: '#34D399',
  minTouchTarget: 44,
  compactBreakpoint: 390,
  contentPadding: 16,
  panelRadius: 26,
  cardRadius: 18,
  revealDuration: 320,
} as const;

export function getLeagueVisualPreferences(
  reduceTransparency: boolean,
  reduceMotion: boolean,
) {
  return {
    canvas: LEAGUE_VISUAL_TOKENS.canvas,
    surface: reduceTransparency
      ? LEAGUE_VISUAL_TOKENS.surfaceOpaque
      : LEAGUE_VISUAL_TOKENS.surface,
    elevated: reduceTransparency
      ? LEAGUE_VISUAL_TOKENS.elevatedOpaque
      : LEAGUE_VISUAL_TOKENS.elevated,
    stroke: reduceTransparency
      ? LEAGUE_VISUAL_TOKENS.strokeOpaque
      : LEAGUE_VISUAL_TOKENS.stroke,
    surfaceTop: reduceTransparency
      ? LEAGUE_VISUAL_TOKENS.surfaceOpaque
      : LEAGUE_VISUAL_TOKENS.surfaceTop,
    surfaceBottom: reduceTransparency
      ? LEAGUE_VISUAL_TOKENS.elevatedOpaque
      : LEAGUE_VISUAL_TOKENS.surfaceBottom,
    revealDuration: reduceMotion ? 0 : LEAGUE_VISUAL_TOKENS.revealDuration,
    showAtmosphericGlow: !reduceTransparency,
  } as const;
}
