import { LEAGUE_VISUAL_TOKENS } from './league';

const colors = {
  // Brand
  primary: '#22D3EE',
  brandRink: '#22D3EE',
  brandArena: '#2563EB',
  brandGold: '#D4AF37',

  // Backgrounds (3 elevation levels)
  bgBase: LEAGUE_VISUAL_TOKENS.canvas,       // Level 1 — shared arena canvas
  bgSurface: LEAGUE_VISUAL_TOKENS.surface,  // Level 2 — accepted Home glass
  bgInteractive: '#1C2A42',
  bgElevated: LEAGUE_VISUAL_TOKENS.elevated,
  bgMedia: LEAGUE_VISUAL_TOKENS.surfaceOpaque,
  bgModal: LEAGUE_VISUAL_TOKENS.elevatedOpaque,
  bgControlOpaque: '#1C2A42',
  glassStroke: LEAGUE_VISUAL_TOKENS.highlight,
  glassStrokeStrong: LEAGUE_VISUAL_TOKENS.stroke,
  glassHighlight: LEAGUE_VISUAL_TOKENS.rinkLine,
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
  navy: LEAGUE_VISUAL_TOKENS.canvas,
  background: LEAGUE_VISUAL_TOKENS.canvas,
  card: LEAGUE_VISUAL_TOKENS.surface,
};

export default colors;
