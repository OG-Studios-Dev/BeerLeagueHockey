import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url).toString()), 'utf8');
}

describe('native league page source binding', () => {
  it('binds Teams to the strict loader, grouped cards, season/division controls and five-metric positioning', () => {
    const teams = source('../../src/screens/league-pages/TeamsDirectoryScreen.tsx');
    const common = source('../../src/screens/league-pages/LeaguePageCommon.tsx');
    assert.match(common, /getLeaguePage/);
    assert.match(common, /createLatestRequestGate/);
    assert.match(teams, /buildTeamsDirectoryView/);
    assert.match(teams, /POSITION_METRICS\.map/);
    assert.match(teams, /Team Positioning/);
    assert.match(teams, /Estimated from confirmed attendance plus roster appearances/);
    assert.match(teams, /team-positioning-chart/);
    assert.match(teams, /connected crest chart/i);
    assert.match(teams, /buildBumpChartSegment/);
    assert.match(teams, /horizontal/);
    assert.doesNotMatch(teams, /rankBar|metricCard/);
    assert.match(teams, /View (?:Current )?Roster/);
    assert.match(teams, /TeamLogo/);
    assert.doesNotMatch(teams, /WebView|Linking\.openURL/);
  });

  it('renders a seasonal roster directory with native player/team drilldowns and resilient filters', () => {
    const players = source('../../src/screens/league-pages/PlayersDirectoryScreen.tsx');
    assert.match(players, /filterPlayers/);
    assert.match(players, /reconcilePlayerFilters/);
    assert.match(players, /Search name or jersey/);
    assert.match(players, /All Teams/);
    assert.match(players, /All Positions/);
    assert.match(players, /jerseyNumber === null/);
    assert.match(players, /Captain|Alternate Captain/);
    assert.match(players, /Avatar/);
    assert.match(players, /TeamLogo/);
    assert.match(players, /LeaguePlayerCard/);
    assert.match(players, /LeagueTeamDetail/);
    assert.doesNotMatch(players, /WebView|Linking\.openURL/);
  });

  it('renders official playoff rounds separately from a local labeled preview and native actions', () => {
    const playoffs = source('../../src/screens/league-pages/PlayoffsDirectoryScreen.tsx');
    assert.match(playoffs, /buildPlayoffsDirectoryView/);
    assert.match(playoffs, /Official Bracket/);
    assert.match(playoffs, /officialDivisionId/);
    assert.match(playoffs, /official series/);
    assert.match(playoffs, /Preview Only/);
    assert.match(playoffs, /Projected Playoff Seeding/);
    assert.match(playoffs, /Regenerate Preview/);
    assert.match(playoffs, /points\} pts/);
    assert.match(playoffs, /Winner of Series/);
    assert.match(playoffs, /TeamLogo/);
    assert.match(playoffs, /emptySeedLabel\(series/);
    assert.match(playoffs, /BYE/);
    assert.match(playoffs, /TBD/);
    assert.match(playoffs, /Champion/);
    assert.match(playoffs, /LeagueGamePreview/);
    assert.match(playoffs, /Standings/);
    assert.match(playoffs, /Schedule/);
    assert.match(playoffs, /setPreview\(null\)/);
    assert.ok(playoffs.indexOf('Projected Playoff Seeding') < playoffs.indexOf('Official Bracket'));
    assert.doesNotMatch(playoffs, /WebView|Linking\.openURL|\.insert\(|\.update\(/);
  });

  it('keys hook state to league and season so previous-scope data is never rendered', () => {
    const common = source('../../src/screens/league-pages/LeaguePageCommon.tsx');
    assert.match(common, /selection\.scopeKey === scopeKey/);
    assert.match(common, /result\?\.requestScope === requestScope/);
    assert.match(common, /defaultSeason\?\.scopeKey === scopeKey/);
  });
});
