import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import ts from 'typescript';

const testPath = fileURLToPath(import.meta.url);
const mobileRoot = testPath.replace(/tests\/ui-rebuild\/home-league-hero-wiring\.test\.ts$/, '');
const source = readFileSync(`${mobileRoot}src/screens/HomeScreen.tsx`, 'utf8');

describe('Home league hero wiring', () => {
  it('mounts the dedicated hero before News from active-league identity and theme facts', () => {
    assert.match(source, /import HomeLeagueHero from ['"]\.\.\/components\/HomeLeagueHero['"]/);
    assert.match(source, /<HomeLeagueHero[\s\S]*leagueId=\{activeLeague\.id\}[\s\S]*leagueName=\{activeLeague\.name\}[\s\S]*logoUrl=\{activeLeague\.logoUrl\}[\s\S]*primaryColor=\{activeTheme\.primaryColor\}[\s\S]*secondaryColor=\{activeTheme\.secondaryColor\}/);
    assert.ok(source.indexOf('<HomeLeagueHero') < source.indexOf('testID="home-news-section"'));
  });

  it('keeps Updates in the masthead and passes both accessibility preferences', () => {
    assert.match(source, /<HomeLeagueHero[\s\S]*reduceMotion=\{reduceMotion\}[\s\S]*reduceTransparency=\{reduceTransparency\}/);
    assert.match(source, /<HomeLeagueHero[\s\S]*updatesAction=\{/);
    assert.match(source, /accessibilityLabel="Updates"/);
  });

  it('resolves the public entrypoint directly to TSX with no production test bridge', () => {
    assert.equal(existsSync(`${mobileRoot}src/components/HomeLeagueHero.ts`), false);
    const resolved = ts.resolveModuleName('../components/HomeLeagueHero', `${mobileRoot}src/screens/HomeScreen.tsx`, {
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.React,
    }, ts.sys).resolvedModule?.resolvedFileName;
    assert.match(resolved ?? '', /HomeLeagueHero\.tsx$/);
  });
});
