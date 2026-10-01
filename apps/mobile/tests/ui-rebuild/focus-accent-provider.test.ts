import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveFocusAccent } from '../../src/theme/focusAccent.ts';
import { compileCommonJs, createHookHarness } from './component-harness.ts';

type ShellData = {
  identityKey: string;
  team: { primary_color: string | null } | null;
};

function createProviderFixture(initialData: ShellData, leaguePrimary = '#315EA8') {
  const harness = createHookHarness();
  let data = initialData;
  const runtime = compileCommonJs<{
    MobileShellDataProvider(props: Record<string, unknown>): unknown;
    useMobileShellData(): { focusAccent: string };
  }>(new URL('../../src/navigation/MobileShellDataContext.tsx', import.meta.url), {
    react: harness.react,
    '../config/hockeyLife': { HOCKEY_LIFE_PRIMARY: '#03299B' },
    '../components/cutIceTitleModel': { resolveCutIceAccent: (value: unknown) => value },
    '../theme/focusAccent': { resolveFocusAccent },
    './useMobileDockData': { useMobileDockData: () => data },
  });
  harness.mount(() => runtime.MobileShellDataProvider({ leagueId: 'league-a', leaguePrimary, userId: 'viewer', children: null }));
  return {
    accent: () => runtime.useMobileShellData().focusAccent,
    setData(next: ShellData) { data = next; harness.render(); },
  };
}

describe('focus accent provider', () => {
  it('publishes each approved current-season viewer team colour', () => {
    for (const color of ['#B31B34', '#1F6A44', '#D47A16', '#6046A8']) {
      const fixture = createProviderFixture({ identityKey: `viewer:${color}`, team: { primary_color: color } });
      assert.equal(fixture.accent(), color);
    }
  });

  it('uses a validated league fallback for guests, missing teams, and malformed team colours', () => {
    assert.equal(resolveFocusAccent(null, '#315EA8'), '#315EA8');
    assert.equal(resolveFocusAccent('pale-blue', '#315EA8'), '#315EA8');
    assert.equal(resolveFocusAccent(null, 'not-a-colour'), '#03299B');
  });

  it('clears the previous identity accent during an A-B-A route transition', () => {
    const fixture = createProviderFixture({ identityKey: 'viewer:league-a', team: { primary_color: '#B31B34' } });
    assert.equal(fixture.accent(), '#B31B34');
    fixture.setData({ identityKey: 'viewer:league-b', team: null });
    assert.equal(fixture.accent(), '#315EA8');
    fixture.setData({ identityKey: 'viewer:league-a', team: { primary_color: '#1F6A44' } });
    assert.equal(fixture.accent(), '#1F6A44');
  });

  it('moves viewer green to viewed purple to league-home green without leaking the page accent', () => {
    const fixture = createProviderFixture(
      { identityKey: 'viewer:league-home', team: { primary_color: '#1F6A44' } },
      '#237A3B',
    );
    assert.equal(fixture.accent(), '#1F6A44');
    assert.equal(resolveFocusAccent('#6046A8', fixture.accent()), '#6046A8');
    fixture.setData({ identityKey: 'guest:league-home', team: null });
    assert.equal(fixture.accent(), '#237A3B');
  });
});
