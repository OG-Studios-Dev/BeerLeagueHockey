import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { loadHockeyLifePlayerPage } from '../../src/lib/supabase/playerPage.ts';

const source = readFileSync(fileURLToPath(new URL('../../src/lib/supabase/playerPage.ts', import.meta.url).toString()), 'utf8');

describe('Hockey Life player page public boundary', () => {
  it('preserves the named loader export while removing every direct database fallback', () => {
    assert.equal(typeof loadHockeyLifePlayerPage, 'function');
    assert.match(source, /api\/mobile\/player-profile/);
    assert.match(source, /credentials: 'omit'/);
    assert.doesNotMatch(source, /supabase|service[_-]?role|\.from\(/i);
  });

  it('does not send arbitrary tenant scope, cookies, or server credentials', () => {
    assert.doesNotMatch(source, /searchParams\.set\(['"](?:league|tenant)/);
    assert.doesNotMatch(source, /Authorization|apikey|cookie/i);
    assert.match(source, /HOCKEY_LIFE_ID/);
    assert.match(source, /HOCKEY_LIFE_SLUG/);
  });
});
