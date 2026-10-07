import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const homeSource = readFileSync(new URL('../../src/screens/HomeScreen.tsx', import.meta.url).pathname, 'utf8');

describe('Home League Leaders integration', () => {
  it('mounts the extracted current-season module with Points as the changed default', () => {
    assert.match(homeSource, /import HomeLeagueLeaders from ['"]\.\.\/components\/HomeLeagueLeaders['"]/);
    assert.match(homeSource, /useState<HomeLeaderMetric>\(['"]points['"]\)/);
    assert.match(homeSource, /<HomeLeagueLeaders/);
    assert.match(homeSource, /const renderedPublicHome = publicHome/);
    assert.match(homeSource, /publicHome\.leagueId === activeLeague\.id/);
    assert.match(homeSource, /publicHome\.leagueSlug === activeLeague\.slug/);
    assert.match(homeSource, /const selectedLeaderSection = leaderMetric === ['"]gaa['"] \? renderedPublicHome\?\.goalieLeaders : renderedPublicHome\?\.leaders/);
    assert.match(homeSource, /leaders=\{selectedLeaderSection\?\.data \?\? \[\]\}/);
    assert.match(homeSource, /selectedLeaderSection\?\.status === ['"]error['"]/);
    assert.match(homeSource, /seasonName=\{renderedPublicHome\?\.presentationSeason\?\.name \?\? null\}/);
    assert.match(homeSource, /manifestRefreshKey=\{renderedPublicHome\}/);
  });

  it('keeps player and all-stats navigation wired while preserving latest-four articles', () => {
    assert.match(homeSource, /navigateToPlayerCard\(navigation, \{ playerId, leagueId: activeLeague\.id \}\)/);
    assert.match(homeSource, /navigation\?\.navigate\?\.\(['"]Stats['"], \{ screen: ['"]Leaderboards['"] \}\)/);
    assert.match(homeSource, /articles\.data \?\? \[\]\)\.slice\(0, 4\)/);
  });
});
