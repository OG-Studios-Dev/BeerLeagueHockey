import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  HOCKEY_LIFE_ID,
  HOCKEY_LIFE_SLUG,
  selectHockeyLifeMembership,
} from '../../src/config/hockeyLife.ts';

const league = (id: string, slug: string, name: string) => ({
  id,
  slug,
  name,
  logo_url: null,
  city: null,
  primary_color: null,
  secondary_color: null,
});

describe('Hockey Life single-league selection', () => {
  it('uses the canonical production Hockey Life tenant', () => {
    assert.equal(HOCKEY_LIFE_ID, 'd6e55507-6eae-4d94-978c-47c6c30a36f1');
    assert.equal(HOCKEY_LIFE_SLUG, 'hockey-life');
  });

  it('deterministically keeps Hockey Life for a multi-membership user and ignores stale persistence', () => {
    const other = league('other-id', 'other-league', 'Other League');
    const hockeyLife = league(HOCKEY_LIFE_ID, HOCKEY_LIFE_SLUG, 'Database Hockey Life');
    const selected = selectHockeyLifeMembership([other, hockeyLife], other.id);

    assert.equal(selected.active?.id, HOCKEY_LIFE_ID);
    assert.equal(selected.active?.name, 'Database Hockey Life', 'database fields remain authoritative');
    assert.deepEqual(selected.available.map((row) => row.id), [HOCKEY_LIFE_ID]);
    assert.equal(selected.shouldClearPersistedSelection, true);
  });

  it('does not fall through to another league when Hockey Life is inaccessible', () => {
    const selected = selectHockeyLifeMembership([
      league('other-id', 'other-league', 'Other League'),
    ], 'other-id');

    assert.equal(selected.active, null);
    assert.deepEqual(selected.available, []);
    assert.equal(selected.accessState, 'hockey-life-membership-required');
  });

  it('does not register switch, selection, marketplace, or discovery routes', () => {
    const app = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url).toString()), 'utf8');
    const navigation = readFileSync(fileURLToPath(new URL('../../src/navigation/index.tsx', import.meta.url).toString()), 'utf8');
    const dock = readFileSync(fileURLToPath(new URL('../../src/navigation/MobileWebDock.tsx', import.meta.url).toString()), 'utf8');
    for (const source of [app, navigation]) {
      assert.doesNotMatch(source, /name="(?:LeagueSelect|LeagueMarketplace|Discover)"/);
    }
    assert.doesNotMatch(dock, /Switch league|LeagueSelect|Discover Leagues/);
  });

  it('keeps every registered league-data screen fail-closed to Hockey Life', () => {
    for (const relativePath of [
      'src/screens/StandingsScreen.tsx',
      'src/screens/ScheduleScreen.tsx',
      'src/screens/StatsScreen.tsx',
      'src/screens/TeamScreen.tsx',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url).toString()), 'utf8');
      assert.doesNotMatch(source, /setActiveLeague|across every (?:BLH )?league|across the leagues|Select or discover a league|Choose a league/);
      assert.match(source, /Hockey Life access/);
    }
  });
});
