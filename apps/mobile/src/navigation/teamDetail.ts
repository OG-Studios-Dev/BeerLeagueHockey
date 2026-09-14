export type TeamDetailParams = { teamId: string; leagueId: string };

type NavigationLike = {
  getState?: () => { routeNames?: string[] } | undefined;
  navigate: (routeName: string, params: unknown) => void;
};

export function navigateToTeamDetail(navigation: unknown, params: TeamDetailParams) {
  const target = navigation as NavigationLike;
  const routeNames = target.getState?.()?.routeNames;

  if (routeNames?.includes('LeagueTeamDetail')) {
    target.navigate('LeagueTeamDetail', params);
    return;
  }

  if (routeNames?.includes('TeamDetail')) {
    target.navigate('TeamDetail', params);
    return;
  }

  target.navigate('Team', {
    screen: 'TeamDetail',
    params,
  });
}
