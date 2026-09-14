import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  contactActionUrl,
  eventGroups,
  normalizeTimeZone,
  validateContactDraft,
} from '../../src/lib/eventsContactModel.ts';

describe('Events and Contact presentation model', () => {
  it('groups synthetic events against generatedAt and keeps unknown types truthful', () => {
    const base = { description: null, location: null };
    const groups = eventGroups([
      { ...base, id: '1', title: 'Now', eventType: 'unknown-kind', startTime: '2026-09-14T11:00:00Z', endTime: '2026-09-14T13:00:00Z' },
      { ...base, id: '2', title: 'Next', eventType: 'social', startTime: '2026-09-15T12:00:00Z', endTime: null },
      { ...base, id: '3', title: 'Earlier', eventType: 'meeting', startTime: '2026-09-13T12:00:00Z', endTime: null },
    ], '2026-09-14T12:00:00Z');
    assert.deepEqual(groups.happeningNow.map((event) => event.title), ['Now']);
    assert.deepEqual(groups.upcoming.map((event) => event.title), ['Next']);
    assert.deepEqual(groups.recent.map((event) => event.title), ['Earlier']);
    assert.equal(groups.happeningNow[0]?.eventType, 'unknown-kind');
    assert.equal(normalizeTimeZone('Not/AZone'), 'UTC');
  });

  it('allows only safe contact actions and validates bounded form input', () => {
    assert.equal(contactActionUrl('email', 'league@example.test'), 'mailto:league%40example.test');
    assert.equal(contactActionUrl('phone', '+1 (416) 555-0100'), 'tel:+14165550100');
    assert.equal(contactActionUrl('website', 'https://example.test/contact'), 'https://example.test/contact');
    assert.equal(contactActionUrl('website', 'javascript:alert(1)'), null);
    assert.equal(contactActionUrl('email', 'bad\n@example.test'), null);
    assert.deepEqual(validateContactDraft({ name: ' ', email: 'bad', subject: '', message: '' }), {
      name: 'Enter your name.', email: 'Enter a valid email address.', subject: 'Enter a subject.', message: 'Enter a message.',
    });
    assert.equal(validateContactDraft({ name: 'A'.repeat(101), email: 'a@example.test', subject: 'Hello', message: 'Body' }).name, 'Name must be 100 characters or fewer.');
  });
});
