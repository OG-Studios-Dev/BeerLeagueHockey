import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { submitContactSubmission } from '../../src/lib/supabase/contact.ts';
import { compileCommonJs } from './component-harness.ts';

describe('contact submission write boundary', () => {
  it('passes only canonical bounded fields through an injected offline adapter', async () => {
    let inserted: unknown;
    const result = await submitContactSubmission({
      leagueId: '11111111-1111-4111-8111-111111111111',
      draft: { name: '  Test Person  ', email: 'test@example.test', subject: '  Question ', message: '  Synthetic body  ' },
    }, async (row) => { inserted = row; return { error: null }; });
    assert.deepEqual(inserted, {
      league_id: '11111111-1111-4111-8111-111111111111', name: 'Test Person', email: 'test@example.test',
      subject: 'Question', message: 'Synthetic body', is_read: false,
    });
    assert.deepEqual(result, { success: true, error: null });
  });

  it('does not call the adapter for invalid input and exposes SDK errors without retrying', async () => {
    let calls = 0;
    const invalid = await submitContactSubmission({ leagueId: 'bad', draft: { name: '', email: '', subject: '', message: '' } }, async () => { calls += 1; return { error: null }; });
    assert.equal(invalid.success, false);
    assert.equal(calls, 0);

    const failed = await submitContactSubmission({
      leagueId: '11111111-1111-4111-8111-111111111111',
      draft: { name: 'Tester', email: 'test@example.test', subject: 'Question', message: 'Synthetic body' },
    }, async () => { calls += 1; return { error: { message: 'Synthetic denied' } }; });
    assert.deepEqual(failed, { success: false, error: 'Synthetic denied' });
    assert.equal(calls, 1);
  });

  it('uses the default SDK query path with an injected offline client', async () => {
    const calls: Array<{ table: string; row?: unknown }> = [];
    const helper = compileCommonJs<typeof import('../../src/lib/supabase/contact.ts')>(new URL('../../src/lib/supabase/contact.ts', import.meta.url), {
      './client': { supabase: { from(table: string) {
        const call: { table: string; row?: unknown } = { table };
        calls.push(call);
        return { async insert(row: unknown) { call.row = row; return { error: null }; } };
      } } },
    });
    const result = await helper.submitContactSubmission({
      leagueId: '11111111-1111-4111-8111-111111111111',
      draft: { name: 'Offline', email: 'offline@example.test', subject: 'Question', message: 'No network' },
    });
    assert.deepEqual(result, { success: true, error: null });
    assert.deepEqual(calls, [{ table: 'contact_submissions', row: {
      league_id: '11111111-1111-4111-8111-111111111111', name: 'Offline', email: 'offline@example.test',
      subject: 'Question', message: 'No network', is_read: false,
    } }]);
  });
});
