import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const screen = readFileSync(fileURLToPath(new URL('../../src/screens/PlayerCardScreen.tsx', import.meta.url).toString()), 'utf8');
const loader = readFileSync(fileURLToPath(new URL('../../src/lib/supabase/playerPage.ts', import.meta.url).toString()), 'utf8');

describe('native Hockey Life player parity screen', () => {
  it('renders the website sections in exact order and has explicit empty states', () => {
    const labels = ['Achievements', 'Season Stats', 'Career Stats', 'Game Log', 'Matchup Stats', 'In The News', 'Season History'];
    let previous = -1;
    for (const label of labels) {
      const index = screen.indexOf(`title="${label}"`);
      assert.ok(index > previous, `${label} must appear after the previous parity section`);
      previous = index;
    }
    assert.match(screen, /No stats available/);
    assert.match(screen, /No games played this season/);
  });

  it('uses the Hockey Life loader and identity gate rather than direct cross-league reads', () => {
    assert.match(screen, /loadHockeyLifePlayerPage/);
    assert.match(screen, /createPlayerRequestGate/);
    assert.doesNotMatch(screen, /Across Beer League Hockey|uniqueLeagueCount|Season Radar/);
    assert.match(loader, /HOCKEY_LIFE_ID/);
    assert.match(loader, /\.eq\('league_id', HOCKEY_LIFE_ID\)/);
    assert.doesNotMatch(loader, /select\('\*'\)|select\(`\s*\*/);
  });
});
