import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness';

const GAME = {
  homeTeam: 'Home',
  awayTeam: 'Away',
  scheduledAt: '2026-10-01T20:00:00.000Z',
  location: 'Rink 1',
};

function calendarFixture(options: { permission: string; calendars?: Array<Record<string, unknown>> }) {
  const events: Array<{ calendarId: string; details: Record<string, unknown> }> = [];
  const alerts: Array<{ title: string; message?: string }> = [];
  let calendarReads = 0;
  const calendarModule = compileCommonJs<typeof import('../../src/lib/calendar')>(
    new URL('../../src/lib/calendar.ts', import.meta.url),
    {
      'expo-calendar': {
        EntityTypes: { EVENT: 'event' },
        requestCalendarPermissionsAsync: async () => ({ status: options.permission }),
        getCalendarsAsync: async () => { calendarReads += 1; return options.calendars ?? []; },
        createEventAsync: async (calendarId: string, details: Record<string, unknown>) => {
          events.push({ calendarId, details });
          return 'event-id';
        },
      },
      'react-native': { Alert: { alert: (title: string, message?: string) => alerts.push({ title, message }) } },
    },
  );
  return { ...calendarModule, events, alerts, get calendarReads() { return calendarReads; } };
}

describe('calendar write target selection', () => {
  it('stops before calendar discovery when permission is denied', async () => {
    const fixture = calendarFixture({ permission: 'denied' });

    assert.equal(await fixture.addGameToCalendar(GAME), false);
    assert.equal(fixture.calendarReads, 0);
    assert.deepEqual(fixture.events, []);
    assert.equal(fixture.alerts[0]?.title, 'Permission denied');
  });

  it('fails safely when the device exposes no writable event calendar', async () => {
    const fixture = calendarFixture({
      permission: 'granted',
      calendars: [{ id: 'read-only', type: 'local', allowsModifications: false }],
    });

    assert.equal(await fixture.addGameToCalendar(GAME), false);
    assert.deepEqual(fixture.events, []);
    assert.equal(fixture.alerts[0]?.title, 'No Writable Calendar');
  });

  it('selects a writable target and never falls back to the first read-only calendar', async () => {
    const fixture = calendarFixture({
      permission: 'granted',
      calendars: [
        { id: 'first-read-only', type: 'local', allowsModifications: false },
        { id: 'writable-synced', type: 'caldav', allowsModifications: true },
      ],
    });

    assert.equal(await fixture.addGameToCalendar(GAME), true);
    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0]?.calendarId, 'writable-synced');
  });
});
