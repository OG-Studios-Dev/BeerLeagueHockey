export function getTabBarLayout(bottomInset: number) {
  const paddingBottom = Math.max(bottomInset, 8);

  return {
    height: 58 + paddingBottom,
    paddingBottom,
    paddingTop: 6,
    itemMinHeight: 44,
  } as const;
}

export function getMobileDockLayout(width: number, bottomInset: number, height: number, topInset: number) {
  const compact = width < 360;
  return {
    outerHeight: (compact ? 114 : 124) + bottomInset,
    exteriorBottomOffset: 0,
    horizontalPadding: compact ? 4 : 8,
    safeAreaPaddingBottom: Math.max(bottomInset, 6),
    touchMin: 44,
    crestSize: compact ? 97.5 : 112.5,
    crestArtSize: compact ? 87.5 : 102.5,
    teamColumnWidth: compact ? 104 : 120,
    topPadding: compact ? 34 : 42,
    tileColumns: width <= 320 ? 2 : 3,
    sheetMaxHeight: Math.max(280, height - topInset - bottomInset - 52),
    compact,
  } as const;
}

export function getDockAccessibilityVisuals(reduceMotion: boolean, reduceTransparency: boolean) {
  return {
    animate: !reduceMotion,
    fadeSheet: !reduceMotion,
    glassGradient: !reduceTransparency,
    opaqueSurface: reduceTransparency,
  } as const;
}
