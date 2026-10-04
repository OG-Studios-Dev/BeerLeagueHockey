import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const homeSource = readFileSync(new URL('../../src/screens/HomeScreen.tsx', import.meta.url).pathname, 'utf8');

describe('Home League Leaders integration', () => {
  it('mounts the extracted current-season module with Points as the changed default', () => {
    assert.match(homeSource, /import HomeLeagueLeaders from ['"]\.\.\/components\/HomeLeagueLeaders['"]/);
    assert.match(homeSource, /useState<HomeLeaderMetric>\(['"]points['"]\)/);
    assert.match(homeSource, /<HomeLeagueLeaders/);
    assert.match(homeSource, /leaders=\{publicHome\?\.leaders\.data \?\? \[\]\}/);
    assert.match(homeSource, /seasonName=\{publicHome\?\.presentationSeason\?\.name \?\? null\}/);
  });

  it('keeps player and all-stats navigation wired while preserving latest-four articles', () => {
    assert.match(homeSource, /navigateToPlayerCard\(navigation, \{ playerId, leagueId: activeLeague\.id \}\)/);
    assert.match(homeSource, /navigation\?\.navigate\?\.\(['"]Stats['"], \{ screen: ['"]Leaderboards['"] \}\)/);
    assert.match(homeSource, /articles\.data \?\? \[\]\)\.slice\(0, 4\)/);
  });
});
