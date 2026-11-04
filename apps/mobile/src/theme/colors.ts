const colors = {
  // Brand
  primary: '#22D3EE',
  brandRink: '#22D3EE',
  brandArena: '#2563EB',
  brandGold: '#D4AF37',

  // Backgrounds (3 elevation levels)
  bgBase: '#07111F',          // Level 1 — midnight canvas
  bgSurface: 'rgba(12, 27, 49, 0.72)',     // Level 2 — translucent slate panels
  bgInteractive: 'rgba(28, 42, 66, 0.84)', // Level 3 — controls
  bgElevated: 'rgba(10, 22, 40, 0.88)',
  glassStroke: 'rgba(255, 255, 255, 0.12)',
  glassStrokeStrong: 'rgba(96, 165, 250, 0.28)',
  glassHighlight: 'rgba(255, 255, 255, 0.08)',
  glassGlow: 'rgba(34, 211, 238, 0.22)',

  // Text — ALL must pass contrast on bg levels above
  textPrimary: '#F7FBFF',     // headlines, primary content
  textSecondary: '#A8B4C8',   // body copy, metadata
  textOnPrimary: '#02111B',   // text ON the cyan primary button
  textInteractive: '#67E8F9', // links, brand-colored elements

  // Borders
  borderCard: 'rgba(255, 255, 255, 0.1)',

  // Buttons
  buttonDefault: '#22D3EE',
  buttonPressed: '#67E8F9',

  // Status badges
  badgeUpcomingBg: 'rgba(34, 211, 238, 0.2)',
  badgeUpcomingText: '#F0F6FC',
  badgeLiveBg: '#DA3633',
  badgeLiveText: '#F0F6FC',
  badgeFinalBg: 'rgba(255, 255, 255, 0.1)',
  badgeFinalText: '#C9D1D9',

  // Tab bar
  tabBarBg: 'rgba(10, 16, 28, 0.82)',
  tabActive: '#67E8F9',
  tabInactive: '#94A3B8',

  // Accents
  accentGreen: '#22C55E',
  accentRed: '#EF4444',
  accentViolet: '#8E7FFF',

  // Legacy aliases (keep for compatibility)
  navy: '#07111F',
  background: '#07111F',
  card: 'rgba(12, 27, 49, 0.72)',
};

export default colors;
