import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDockRequestGate,
  isDockRegistrationOpen,
  parseWebsiteSettings,
  selectDockRegistrationSeason,
  selectOperationalDockSeason,
} from '../../src/navigation/dockData.ts';

const seasons = [
  { id: 'history', league_id: 'league-a', status: 'completed', start_date: '2025-01-01', created_at: '2024-12-01' },
  { id: 'playoffs-new', league_id: 'league-a', status: 'playoffs', start_date: '2026-10-01', created_at: '2026-09-01' },
  { id: 'active-current', league_id: 'league-a', status: 'active', start_date: '2026-09-01', created_at: '2026-08-01' },
  { id: 'wrong-league', league_id: 'league-b', status: 'active', start_date: '2027-01-01', created_at: '2026-12-01' },
];

describe('dock league-season state', () => {
  it('sanitizes website metadata fields before they reach rendering', () => {
    assert.deepEqual(parseWebsiteSettings({ website: {
      visiblePages: { teams: true, news: false, gallery: 1, events: 'yes' },
      navItems: [
        null,
        [],
        { label: 7, href: '/bad-label' },
        { label: 'Bad href', href: 7 },
        { label: 'Bad flag', href: '/bad-flag', isExternal: 1 },
        { label: 'Rules', pageSlug: 'rules', isCustomPage: true },
        { label: 'Shop', href: 'https://shop.example.test', isExternal: true },
      ],
    } }), {
      visiblePages: { teams: true, news: false },
      navItems: [
        { label: 'Rules', pageSlug: 'rules', isCustomPage: true },
        { label: 'Shop', href: 'https://shop.example.test', isExternal: true },
      ],
    });
    assert.deepEqual(parseWebsiteSettings({ website: {} }), { visiblePages: undefined, navItems: [] });
  });

  it('uses the same active-before-playoffs deterministic current-season rule as Team', () => {
    assert.equal(selectOperationalDockSeason(seasons, 'league-a')?.id, 'active-current');
    assert.equal(selectOperationalDockSeason(seasons.filter((row) => row.status !== 'active'), 'league-a')?.id, 'playoffs-new');
    assert.equal(selectOperationalDockSeason(seasons, 'missing'), null);
  });

  it('rejects stale auth/league responses and invalidates pending work', () => {
    const gate = createDockRequestGate();
    const first = gate.begin('user-a:league-a');
    const second = gate.begin('user-b:league-b');

    assert.equal(gate.isCurrent(first, 'user-b:league-b'), false);
    assert.equal(gate.isCurrent(second, 'user-b:league-b'), true);
    gate.invalidate();
    assert.equal(gate.isCurrent(second, 'user-b:league-b'), false);
  });

  it('matches the current web registration window semantics', () => {
    const now = new Date('2026-09-11T12:00:00.000Z');
    assert.equal(isDockRegistrationOpen({
      id: 'active', league_id: 'league-a', status: 'active', start_date: '2026-09-01',
      registration_opens_at: '2026-09-01T00:00:00.000Z', registration_closes_at: '2026-09-10T00:00:00.000Z',
    }, now), true);
    assert.equal(isDockRegistrationOpen({
      id: 'upcoming', league_id: 'league-a', status: 'upcoming', start_date: '2026-10-01',
      registration_opens_at: '2026-09-01T00:00:00.000Z', registration_closes_at: '2026-09-30T00:00:00.000Z',
    }, now), true);
    assert.equal(isDockRegistrationOpen({
      id: 'closed', league_id: 'league-a', status: 'upcoming', start_date: '2026-10-01',
      registration_opens_at: '2026-09-12T00:00:00.000Z', registration_closes_at: null,
    }, now), false);
  });

  it('selects upcoming registration before active, then newest start date', () => {
    const now = new Date('2026-09-11T12:00:00.000Z');
    const selected = selectDockRegistrationSeason([
      { id: 'active', league_id: 'league-a', status: 'active', start_date: '2026-09-01' },
      { id: 'upcoming-old', league_id: 'league-a', status: 'upcoming', start_date: '2026-10-01' },
      { id: 'upcoming-new', league_id: 'league-a', status: 'upcoming', start_date: '2026-11-01' },
    ], now);
    assert.equal(selected?.id, 'upcoming-new');
  });
});
