import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHomeSchemaAwareBoundary } from './home-schema-aware-fixture.ts';

const PUBLIC_SECTIONS = [
  'articles',
  'weeklyGames',
  'leaders',
  'standings',
  'photos',
  'albums',
  'community',
  'sponsors',
] as const;

describe('Home public bootstrap schema contract', () => {
  it('loads independent public sections when every selected column exists in the pinned live schema', async () => {
    const boundary = createHomeSchemaAwareBoundary();
    const result = await boundary.load();

    assert.deepEqual({
      unknownSelectedColumns: boundary.schemaErrors.map(({ table, column, code }) => ({ table, column, code })),
      sectionStatuses: Object.fromEntries(PUBLIC_SECTIONS.map((section) => [section, result[section].status])),
    }, {
      unknownSelectedColumns: [],
      sectionStatuses: Object.fromEntries(PUBLIC_SECTIONS.map((section) => [section, 'ready'])),
    });
    assert.ok(boundary.calls.some((call) => call.table === 'articles' && call.method === 'select'));
    assert.ok(boundary.calls.some((call) => call.table === 'games' && call.method === 'select'));
  });
});
