import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { describe, it } from 'node:test';

const heroUrl = new NodeURL('../../src/screens/TeamScreen/BroadcastTeamHero.tsx', import.meta.url);
const modelUrl = new NodeURL('../../src/screens/TeamScreen/teamBroadcastHeroModel.ts', import.meta.url);
const publicPage = readFileSync(
  fileURLToPath(new NodeURL('../../src/screens/TeamScreen/TeamPublicPage.tsx', import.meta.url)),
  'utf8',
);

describe('approved C broadcast Team hero source contract', () => {
  it('isolates and wires the exact dynamic broadcast treatment into the actual public Team page', () => {
    assert.ok(existsSync(heroUrl), 'BroadcastTeamHero.tsx must own the approved public Team hero');
    const hero = readFileSync(fileURLToPath(heroUrl), 'utf8');
    assert.ok(existsSync(modelUrl), 'teamBroadcastHeroModel.ts must own honest snapshot formatting');
    const model = readFileSync(fileURLToPath(modelUrl), 'utf8');

    assert.match(publicPage, /import BroadcastTeamHero from ['"]\.\/BroadcastTeamHero['"]/);
    assert.match(publicPage, /<BroadcastTeamHero snapshot=\{snapshot\} compact=\{compact\}/);
    assert.doesNotMatch(publicPage, /function Hero\(/);
    assert.match(hero, /require\(['"]\.\.\/\.\.\/assets\/team-page\/trophy\.png['"]\)/);
    assert.match(hero, /resizeMode="contain"/);
    assert.match(hero, /logoUrl=\{team\.logoUrl\}/);
    assert.match(hero, /teamName=\{team\.name\}/);
    assert.match(hero, /team-broadcast-subject-frame/);
    assert.match(hero, /team-broadcast-ticker/);
    assert.match(hero, /team-hero-transition/);
    assert.match(hero, /buildBroadcastTeamHeroModel\(snapshot\)/);
    assert.match(model, /resolveFocusAccent\(team\.primaryColor, snapshot\.league\.primaryColor\)/);
    assert.doesNotMatch(`${hero}${model}`, /Bad Bunny|bad-bunny/i);
    assert.doesNotMatch(hero, /Ionicons[^\n]*trophy|name=[{]?['"]trophy/i);
  });
});
