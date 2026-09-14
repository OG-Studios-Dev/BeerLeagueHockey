import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { buildMoreMenu } from '../../src/navigation/dockMenu.ts';

describe('native league page navigation', () => {
  it('replaces exactly Teams, Players and phase-gated Playoffs with tenant-bound native destinations', () => {
    const items = buildMoreMenu({
      leagueId: '11111111-1111-4111-8111-111111111111',
      leagueSlug: 'hockey-life',
      isPlayoffs: true,
      registrationOpen: false,
      isMember: false,
      isCaptain: false,
    });
    const byLabel = new Map(items.map((item) => [item.label, item.destination]));
    const scope = { leagueId: '11111111-1111-4111-8111-111111111111', leagueSlug: 'hockey-life' };

    assert.deepEqual(byLabel.get('Teams'), { kind: 'native', tab: 'LeaguePages', screen: 'TeamsDirectory', params: scope });
    assert.deepEqual(byLabel.get('Players'), { kind: 'native', tab: 'LeaguePages', screen: 'PlayersDirectory', params: scope });
    assert.deepEqual(byLabel.get('Playoffs'), { kind: 'native', tab: 'LeaguePages', screen: 'PlayoffsDirectory', params: scope });
    assert.deepEqual(byLabel.get('News'), { kind: 'external', url: 'https://hockey-life.beerleaguehockey.ca/news' });

    const regularSeason = buildMoreMenu({
      leagueId: scope.leagueId, leagueSlug: scope.leagueSlug, isPlayoffs: false,
      registrationOpen: false, isMember: false, isCaptain: false,
    });
    assert.equal(regularSeason.some((item) => item.label === 'Playoffs'), false);
  });

  it('registers a hidden league-pages stack with native team, player and game drilldowns', () => {
    const navigation = readFileSync(fileURLToPath(new URL('../../src/navigation/index.tsx', import.meta.url).toString()), 'utf8');
    for (const route of ['TeamsDirectory', 'PlayersDirectory', 'PlayoffsDirectory', 'LeagueTeamDetail', 'LeaguePlayerCard', 'LeagueGamePreview']) {
      assert.match(navigation, new RegExp(`name=["']${route}["']`));
    }
    assert.match(navigation, /name="LeaguePages"/);
    assert.match(navigation, /tabBarButton:\s*\(\)\s*=>\s*null/);
  });
});
