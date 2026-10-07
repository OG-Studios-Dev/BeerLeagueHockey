import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('../../src/screens/HomeScreen.tsx', import.meta.url).pathname, 'utf8');

describe('Home matchup carousel integration', () => {
  it('replaces the vertical weekly game rows with the cinematic canonical-ID carousel', () => {
    assert.match(source, /import HomeMatchupCarousel from ['"]\.\.\/components\/HomeMatchupCarousel['"]/);
    assert.match(source, /<HomeMatchupCarousel/);
    assert.match(source, /games=\{renderedPublicHome\.weeklyGames\.data\}/);
    assert.match(source, /scopeKey=\{`\$\{activeLeague\.id\}:\$\{renderedPublicHome\.weekKey \?\? 'unavailable'\}`\}/);
    assert.match(source, /timezone=\{renderedPublicHome\.timezone\}/);
    assert.match(source, /onOpenGame=\{navigateToGame\}/);
    assert.doesNotMatch(source, /renderedPublicHome\.weeklyGames\.data\.map\(/);
  });

  it('keeps the schedule action beside a plain Home section heading without the removed eyebrow', () => {
    assert.match(source, /<SectionHeading title="This Week’s Games" action=/);
    assert.doesNotMatch(source, /SectionHeading eyebrow="AROUND THE LEAGUE"/);
  });
});
