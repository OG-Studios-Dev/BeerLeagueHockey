import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import ts from 'typescript';

function explicitFocusAccents(relativePath: string) {
  const path = fileURLToPath(new URL(`../../src/${relativePath}`, import.meta.url));
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'FocusCard') {
      const accent = node.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(source) === 'accentColor');
      if (accent) callers.push(node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return callers;
}

it('lets league, game, notification, captain-list, and My Page team-list cards inherit viewer focus', () => {
  for (const path of [
    'screens/league-pages/TeamsDirectoryScreen.tsx',
    'screens/GamePreviewScreen.tsx',
    'screens/games/GameRecapScreen.tsx',
    'screens/NotificationsFeedScreen.tsx',
    'screens/captain/CaptainDashboardScreen.tsx',
  ]) assert.equal(explicitFocusAccents(path).length, 0, path);

  const profile = explicitFocusAccents('screens/ProfileScreen.tsx');
  assert.ok(profile.length > 0);
  assert.equal(profile.some((caller) => caller.includes('profile:team:')), false);
});

it('retains approved page-team and semantic explicit emphasis callers', () => {
  assert.ok(explicitFocusAccents('screens/TeamScreen/TeamPublicPage.tsx').length > 0);
  assert.equal(explicitFocusAccents('screens/PlayerCardScreen.tsx').length, 1);
  assert.equal(explicitFocusAccents('screens/TeamScreen.tsx').length, 1);
  assert.equal(explicitFocusAccents('screens/captain/GameAvailabilityScreen.tsx').length, 1);
  assert.ok(explicitFocusAccents('screens/discover/LeagueDetailScreen.tsx').length > 0);
});
