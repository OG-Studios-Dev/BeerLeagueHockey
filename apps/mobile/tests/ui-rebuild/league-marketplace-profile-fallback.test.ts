import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness';

function marketplaceWith(profileResult: { data: { skill_level: string | null } | null; error: Error | null }) {
  const selects: Array<{ table: string; columns: string }> = [];
  const supabase = {
    from(table: string) {
      const chain: Record<string, any> = {};
      chain.select = (columns: string) => { selects.push({ table, columns }); return chain; };
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.in = async () => ({ data: [], error: null });
      chain.maybeSingle = async () => table === 'player_ratings'
        ? { data: null, error: null }
        : profileResult;
      chain.then = (resolve: (value: unknown) => unknown) => resolve(
        table === 'leagues'
          ? { data: [{ id: 'league-1', name: 'League', slug: 'league', city: null, logo_url: null, primary_color: null, secondary_color: null, short_name: null, is_public: true }], error: null }
          : { data: [], error: null },
      );
      return chain;
    },
  };
  const marketplace = compileCommonJs<{ getLeagueMarketplace(userId: string): Promise<any> }>(
    new URL('../../src/lib/leagueMarketplace.ts', import.meta.url),
    { './supabase/client': { supabase } },
  );
  return { marketplace, selects };
}

describe('marketplace profile fallback', () => {
  it('reads profiles.skill_level and preserves the enum-to-rating mapping', async () => {
    const { marketplace, selects } = marketplaceWith({ data: { skill_level: 'advanced' }, error: null });
    const result = await marketplace.getLeagueMarketplace('player-1');
    assert.ok(selects.some(({ table, columns }) => table === 'profiles' && columns === 'skill_level'));
    assert.equal(result.userTier, 9);
    assert.equal(result.userRating, 'B+');
  });

  it('does not disguise a denied profile fallback as an unrated success', async () => {
    const { marketplace } = marketplaceWith({ data: null, error: new Error('RLS denied') });
    await assert.rejects(() => marketplace.getLeagueMarketplace('player-1'), /profile/i);
  });
});
