export type GamePreviewParams = { gameId: string };

type NavigationLike = {
  getState?: () => { routeNames?: string[] } | undefined;
  navigate: (routeName: string, params: unknown) => void;
};

export function navigateToGamePreview(navigation: unknown, params: GamePreviewParams) {
  const target = navigation as NavigationLike;
  const routeNames = target.getState?.()?.routeNames;

  if (routeNames?.includes('LeagueGamePreview')) {
    target.navigate('LeagueGamePreview', params);
    return;
  }

  if (routeNames?.includes('GamePreview')) {
    target.navigate('GamePreview', params);
    return;
  }

  target.navigate('Schedule', {
    screen: 'GamePreview',
    params,
  });
}
