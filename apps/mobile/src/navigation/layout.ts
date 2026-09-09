export function getTabBarLayout(bottomInset: number) {
  const paddingBottom = Math.max(bottomInset, 8);

  return {
    height: 58 + paddingBottom,
    paddingBottom,
    paddingTop: 6,
    itemMinHeight: 44,
  } as const;
}
