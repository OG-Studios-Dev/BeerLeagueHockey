import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CUT_ICE_EXCLUDED_ROUTES,
  CUT_ICE_ROUTE_TITLES,
  resolveCutIceAccent,
  resolveCutIcePalette,
  splitCutIceTitle,
} from '../../src/components/cutIceTitleModel.ts';
import { REGISTERED_USER_SCREENS } from '../../src/navigation/screenRegistry.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('shared Cut Ice title treatment', () => {
  it('covers every registered user-visible route except Home and active Team detail', () => {
    assert.deepEqual(CUT_ICE_EXCLUDED_ROUTES, ['Home', 'TeamDetail', 'LeagueTeamDetail']);
    const uncovered = REGISTERED_USER_SCREENS.filter((route) =>
      !CUT_ICE_EXCLUDED_ROUTES.includes(route as never) && !CUT_ICE_ROUTE_TITLES[route]);
    assert.deepEqual(uncovered, []);
    const navigation = readFileSync(fileURLToPath(new URL('../../src/navigation/index.tsx', import.meta.url).toString()), 'utf8');
    const app = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url).toString()), 'utf8');
    for (const [route, title] of Object.entries(CUT_ICE_ROUTE_TITLES)) {
      const registrationName = route === 'Standings' || route === 'Schedule' ? 'ScheduleList' : route;
      const source = ['Splash', 'Login', 'ForgotPassword', 'SignUp'].includes(route) ? app : navigation;
      assert.match(source, new RegExp(`name="${registrationName}"[^>]+(?:authCutIceOptions|cutIceOptions)\\('${title!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
    }
  });

  it('is title-only and deterministically splits the final word for team colour', () => {
    assert.deepEqual(splitCutIceTitle('Notification Settings'), { base: 'Notification', accent: 'Settings' });
    assert.deepEqual(splitCutIceTitle('Stats'), { base: '', accent: 'Stats' });
  });

  it('uses a valid team primary colour and falls back to accessible Hockey Life blue', () => {
    assert.equal(resolveCutIceAccent('#E8FF00'), '#E8FF00');
    assert.equal(resolveCutIceAccent('cyan'), '#03299B');
    assert.equal(resolveCutIceAccent(null), '#03299B');
    const fallback = resolveCutIcePalette(null);
    assert.equal(fallback.source, '#03299B');
    assert.ok(fallback.textContrast >= 4.5);
  });
});
