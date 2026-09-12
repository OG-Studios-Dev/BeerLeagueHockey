import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs, createHookHarness } from './component-harness';

type QueryResult = { data: any; error: any };

function createMetadataHook(initialLeagueResult: QueryResult) {
  const harness = createHookHarness();
  let leagueResult = initialLeagueResult;
  let leagueReads = 0;
  const seasonsResult = { data: [], error: null };
  const query = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve(seasonsResult),
      maybeSingle: () => {
        leagueReads += 1;
        return Promise.resolve(leagueResult);
      },
    };
    return chain;
  };
  const useMobileDockData = compileCommonJs<{
    useMobileDockData: (leagueId: string | null, userId: string | null) => any;
  }>(new URL('../../src/navigation/useMobileDockData.ts', import.meta.url), {
    react: harness.react,
    '../lib/supabase/team': { getActiveSeasonTeamForUser: async () => null },
    '../lib/supabase/client': { supabase: { from: query } },
  }).useMobileDockData;
  const mount = () => harness.mount(() => useMobileDockData('league-a', null));
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
      harness.render();
    }
  };
  return {
    harness, mount, settle,
    leagueReads: () => leagueReads,
    setLeagueResult: (next: QueryResult) => { leagueResult = next; },
  };
}

describe('useMobileDockData metadata integration', () => {
  it('moves from loading to ready when successful metadata omits optional settings', async () => {
    const fixture = createMetadataHook({ data: { settings: { website: {} } }, error: null });
    fixture.mount();
    assert.equal((fixture.harness.output as any).websiteStatus, 'loading');
    await fixture.settle();
    assert.equal((fixture.harness.output as any).websiteStatus, 'ready');
    assert.equal((fixture.harness.output as any).visiblePages, undefined);
  });

  it('moves failures to error and retries the lookup for real', async () => {
    const fixture = createMetadataHook({ data: null, error: { message: 'unavailable' } });
    fixture.mount();
    await fixture.settle();
    assert.equal((fixture.harness.output as any).websiteStatus, 'error');
    assert.deepEqual((fixture.harness.output as any).customNavItems, []);

    fixture.setLeagueResult({ data: { settings: { website: { navItems: [{ label: 'Rules', pageSlug: 'rules', isCustomPage: true }] } } }, error: null });
    (fixture.harness.output as any).retry();
    fixture.harness.render();
    assert.equal((fixture.harness.output as any).websiteStatus, 'loading');
    await fixture.settle();
    assert.equal((fixture.harness.output as any).websiteStatus, 'ready');
    assert.deepEqual((fixture.harness.output as any).customNavItems, [{ label: 'Rules', pageSlug: 'rules', isCustomPage: true }]);
    assert.equal(fixture.leagueReads(), 2);
  });
});
