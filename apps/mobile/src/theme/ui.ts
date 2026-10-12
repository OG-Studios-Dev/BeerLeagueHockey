import { LEAGUE_VISUAL_TOKENS } from './league';

export const ui = {
  radius: {
    control: 12,
    card: 18,
    panel: 24,
    pill: 999,
  },
  minTouchTarget: 44,
  spacing: {
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 32,
  },
} as const;

export type VisualPreferences = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  revealDuration: number;
  surfaceMode: 'glass' | 'opaque';
};

export function deriveVisualPreferences(
  reduceMotion: boolean,
  reduceTransparency: boolean,
): VisualPreferences {
  return {
    reduceMotion,
    reduceTransparency,
    revealDuration: reduceMotion ? 0 : 380,
    surfaceMode: reduceTransparency ? 'opaque' : 'glass',
  };
}

export function getSurfacePalette(reduceTransparency: boolean) {
  if (reduceTransparency) {
    return {
      surface: LEAGUE_VISUAL_TOKENS.surfaceOpaque,
      elevated: LEAGUE_VISUAL_TOKENS.elevatedOpaque,
      interactive: '#1C2A42',
      stroke: LEAGUE_VISUAL_TOKENS.strokeOpaque,
    } as const;
  }

  return {
    surface: LEAGUE_VISUAL_TOKENS.surface,
    elevated: LEAGUE_VISUAL_TOKENS.elevated,
    interactive: LEAGUE_VISUAL_TOKENS.control,
    stroke: LEAGUE_VISUAL_TOKENS.stroke,
  } as const;
}
