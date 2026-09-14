import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { navigateToGamePreview } from '../../src/navigation/gamePreview.ts';
import { navigateToPlayerCard } from '../../src/navigation/playerCard.ts';
import { navigateToTeamDetail } from '../../src/navigation/teamDetail.ts';

function stack(routeNames: string[], initialRoutes: string[]) {
  const routes = [...initialRoutes];
  return {
    routes,
    getState: () => ({ routeNames }),
    navigate: (name: string) => routes.push(name),
    goBack: () => routes.pop(),
  };
}

describe('League Pages runtime navigation aliases', () => {
  it('keeps directory -> team -> player -> back -> back in the League Pages stack', () => {
    const navigation = stack(
      ['TeamsDirectory', 'LeagueTeamDetail', 'LeaguePlayerCard', 'LeagueGamePreview', 'TeamChat'],
      ['TeamsDirectory', 'LeagueTeamDetail'],
    );

    navigateToPlayerCard(navigation, { playerId: 'player-1', leagueId: 'league-1' });
    assert.deepEqual(navigation.routes, ['TeamsDirectory', 'LeagueTeamDetail', 'LeaguePlayerCard']);
    navigation.goBack();
    assert.deepEqual(navigation.routes, ['TeamsDirectory', 'LeagueTeamDetail']);
    navigation.goBack();
    assert.deepEqual(navigation.routes, ['TeamsDirectory']);
  });

  it('uses the local game alias when TeamDetail is mounted in League Pages', () => {
    const navigation = stack(['TeamsDirectory', 'LeagueTeamDetail', 'LeagueGamePreview'], ['TeamsDirectory', 'LeagueTeamDetail']);
    navigateToGamePreview(navigation, { gameId: 'game-1' });
    assert.deepEqual(navigation.routes, ['TeamsDirectory', 'LeagueTeamDetail', 'LeagueGamePreview']);
  });

  it('keeps player-card team links inside League Pages with reversible back context', () => {
    const navigation = stack(['PlayersDirectory', 'LeaguePlayerCard', 'LeagueTeamDetail'], ['PlayersDirectory', 'LeaguePlayerCard']);
    navigateToTeamDetail(navigation, { teamId: 'team-1', leagueId: 'league-1' });
    assert.deepEqual(navigation.routes, ['PlayersDirectory', 'LeaguePlayerCard', 'LeagueTeamDetail']);
    navigation.goBack();
    navigation.goBack();
    assert.deepEqual(navigation.routes, ['PlayersDirectory']);
  });

  it('mounts the player and game helpers in the actual detail sources while TeamChat stays local', () => {
    const team = readFileSync(fileURLToPath(new URL('../../src/screens/TeamScreen/TeamDetailScreen.tsx', import.meta.url).toString()), 'utf8');
    const game = readFileSync(fileURLToPath(new URL('../../src/screens/GamePreviewScreen.tsx', import.meta.url).toString()), 'utf8');
    assert.match(team, /navigateToPlayerCard\(navigation/);
    assert.match(team, /navigateToGamePreview\(navigation/);
    assert.match(team, /navigation\.navigate\('TeamChat'/);
    assert.match(game, /navigateToPlayerCard\(navigation/);
    assert.match(readFileSync(fileURLToPath(new URL('../../src/screens/PlayerCardScreen.tsx', import.meta.url).toString()), 'utf8'), /navigateToTeamDetail\(navigation/);
  });
});
