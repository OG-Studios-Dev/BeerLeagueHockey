import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string) {
  return readFileSync(resolve(TEST_DIR, '../../', relativePath), 'utf8');
}

describe('unified Stats navigation', () => {
  it('removes the standalone Leaderboards screen, route, registry/title entries, actions, and navigation callsites', () => {
    const leaderboardsPath = resolve(TEST_DIR, '../../src/screens/stats/LeaderboardsScreen.tsx');
    assert.equal(existsSync(leaderboardsPath), false);

    for (const file of [
      'src/navigation/index.tsx',
      'src/navigation/types.ts',
      'src/navigation/screenRegistry.ts',
      'src/components/cutIceTitleModel.ts',
      'src/screens/StatsScreen.tsx',
      'src/screens/HomeScreen.tsx',
    ]) {
      assert.doesNotMatch(source(file), /Leaderboards|stats-leaderboards-action/, file);
    }

    const manifest = JSON.parse(source('src/rebuild/screen-manifest.json')) as { routes: Array<{ name: string; component: string }> };
    assert.ok(manifest.routes.every((route) => route.name !== 'Leaderboards' && route.component !== 'LeaderboardsScreen'));

    assert.match(source('src/screens/HomeScreen.tsx'), /navigate\?\.\(['"]Stats['"], \{ screen: ['"]StatsMain['"] \}\)/);
    assert.match(source('src/navigation/index.tsx'), /<StatsStack\.Screen name="StatsMain" component=\{StatsScreen\}/);
    assert.match(source('src/navigation/index.tsx'), /<StatsStack\.Screen name="CareerStats" component=\{CareerStatsScreen\}/);
  });

  it('describes the implemented unified Stats source and its exact acceptance contract without legacy semantics', () => {
    const manifest = JSON.parse(source('src/rebuild/screen-manifest.json')) as {
      screens: Array<{
        id: string;
        reachability: string;
        features: string[];
        contracts: string[];
        states: string[];
        acceptanceTests: string[];
        evidence: { sourceImplemented: boolean };
        ownerNotes: string;
      }>;
    };
    const stats = manifest.screens.find((screen) => screen.id === 'stats');
    assert.ok(stats, 'Stats manifest entry exists');
    assert.equal(stats.evidence.sourceImplemented, true);

    const semantics = JSON.stringify(stats);
    for (const required of [
      'page-wide timeline, role, metric, and seasonal division controls',
      'player Goals, Assists, and Points plus goalie GAA',
      'League Leaders top five',
      'complete ranked Player Stats and Goalie Stats table',
      'standalone Leaderboards route, file, registry, title, and callers are absent',
      'Home all-stats CTA opens StatsMain',
      'truthful accessible names, mutual state, and 44pt targets',
      'opaque at opacity 1',
      'adaptive rows at 320/390/430',
    ]) assert.match(semantics, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), required);
    assert.doesNotMatch(semantics, /get_team_standings|get_stats_leaders|get_goalie_season_stats|leaderboard and career routes resolve|Do not change stats contracts/i);

    const checklistLine = source('../../docs/MOBILE-UI-REBUILD-CHECKLIST.md')
      .split('\n')
      .find((line) => line.includes('`src/screens/StatsScreen.tsx`')) ?? '';
    assert.match(checklistLine, /source:yes, browser:no, iOS:no/);
    assert.match(checklistLine, /page-wide timeline\/role\/metric\/division controls/i);
    assert.match(checklistLine, /Goals\/Assists\/Points and goalie GAA/i);
    assert.match(checklistLine, /top-five League Leaders plus complete Player\/Goalie Stats tables/i);
    assert.match(checklistLine, /Leaderboards route\/file\/callers removed/i);
    assert.match(checklistLine, /Home All Stats opens StatsMain/i);
    assert.match(checklistLine, /44pt truthful controls, opaque Reduced Transparency states, and lossless adaptive-height Dynamic Type at 320\/390\/430/i);
    assert.doesNotMatch(checklistLine, /source:no|Do not change stats contracts/i);
  });
});
