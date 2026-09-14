import { PlayerCardParams } from './types';

export function navigateToPlayerCard(navigation: any, params: PlayerCardParams) {
  const routeNames = navigation?.getState?.()?.routeNames as string[] | undefined;

  if (routeNames?.includes('LeaguePlayerCard')) {
    navigation.navigate('LeaguePlayerCard', params);
    return;
  }

  if (routeNames?.includes('PlayerCard')) {
    navigation.navigate('PlayerCard', params);
    return;
  }

  navigation.navigate('Profile', {
    screen: 'PlayerCard',
    params,
  });
}
