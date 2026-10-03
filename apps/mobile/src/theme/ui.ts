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
      surface: '#111E32',
      elevated: '#0C1B31',
      interactive: '#1C2A42',
      stroke: '#41607F',
    } as const;
  }

  return {
    surface: 'rgba(12, 27, 49, 0.72)',
    elevated: 'rgba(10, 22, 40, 0.88)',
    interactive: 'rgba(28, 42, 66, 0.84)',
    stroke: 'rgba(96, 165, 250, 0.28)',
  } as const;
}
