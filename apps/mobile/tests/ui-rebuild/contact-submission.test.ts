import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('keeps the privacy inventory aligned with the actual guest-capable write', async () => {
    let inserted: Record<string, unknown> | undefined;
    await submitContactSubmission({
      leagueId: '11111111-1111-4111-8111-111111111111',
      draft: { name: 'Guest Name', email: 'guest@example.test', subject: 'Help', message: 'Please contact me' },
    }, async (row) => { inserted = row; return { error: null }; });

    assert.ok(inserted);
    assert.deepEqual(
      Object.keys(inserted).filter((key) => ['name', 'email', 'subject', 'message'].includes(key)).sort(),
      ['email', 'message', 'name', 'subject'],
    );
    assert.equal('user_id' in inserted, false, 'contact submissions must not be described as auth-linked rows');

    const privacy = readFileSync(fileURLToPath(new URL('../../APP_STORE_PRIVACY.md', import.meta.url).toString()), 'utf8');
    const inventory = privacy.replace(/\s+/g, ' ');
    assert.match(inventory, /Contact submissions.*name, email, subject, and message/i);
    assert.match(inventory, /purpose.*respond(?:ing)? to (?:a )?league or support inquir/i);
    assert.match(inventory, /not linked by an authenticated user UUID/i);
    assert.match(inventory, /Hockey Life league administrators/i);
    assert.match(inventory, /retained until.*league administrator.*deletes/i);
    assert.match(inventory, /manual erasure request.*identity verification/i);
    assert.match(inventory, /Supabase.*processor/i);
    assert.match(inventory, /not automatically deleted.*account deletion/i);
  });
});
