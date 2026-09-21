import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url).toString()), 'utf8');
}

describe('Team Chat removal', () => {
  it('removes Team Chat from every registered mobile navigator and route type', () => {
    const navigation = source('src/navigation/index.tsx');
    const types = source('src/navigation/types.ts');
    const registry = source('src/navigation/screenRegistry.ts');
    const titles = source('src/components/cutIceTitleModel.ts');

    assert.doesNotMatch(navigation, /TeamChat/);
    assert.doesNotMatch(types, /^\s*TeamChat:/m);
    assert.doesNotMatch(registry, /['"]TeamChat['"]/);
    assert.doesNotMatch(titles, /\bTeamChat\s*:/);
  });

  it('removes member and captain Team Chat actions from reachable screens', () => {
    const teamDetail = source('src/screens/TeamScreen/TeamDetailScreen.tsx');
    const captainDashboard = source('src/screens/captain/CaptainDashboardScreen.tsx');

    assert.doesNotMatch(teamDetail, /team-chat-action|navigate\(['"]TeamChat['"]|>Team Chat</);
    assert.doesNotMatch(captainDashboard, /navigate\(['"]TeamChat['"]|>Announce</);
  });

  it('records the retained implementation as unregistered and has no Team Chat route manifest entries', () => {
    const manifest = JSON.parse(source('src/rebuild/screen-manifest.json')) as {
      screens: Array<{ id: string; reachability: string }>;
      routes: Array<{ name: string }>;
    };
    const screen = manifest.screens.find(({ id }) => id === 'team-chat');

    assert.equal(screen?.reachability, 'Unregistered retained source; no user-visible route');
    assert.equal(manifest.routes.some(({ name }) => name === 'TeamChat'), false);
  });
});
