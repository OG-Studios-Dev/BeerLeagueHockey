import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMoreMenu } from '../../src/navigation/dockMenu.ts';

const base = {
  leagueSlug: 'hockey-life',
  isPlayoffs: false,
  registrationOpen: false,
  userId: null,
  isMember: false,
  isCaptain: false,
};

describe('mobile More catalog', () => {
  it('keeps native entry paths and genuine public page destinations distinct', () => {
    const items = buildMoreMenu(base);
    const byLabel = new Map(items.map((item) => [item.label, item.destination]));

    assert.deepEqual(byLabel.get('Home'), { kind: 'native', tab: 'Home' });
    assert.deepEqual(byLabel.get('Teams'), { kind: 'external', url: 'https://hockey-life.beerleaguehockey.ca/teams' });
    assert.deepEqual(byLabel.get('Players'), { kind: 'external', url: 'https://hockey-life.beerleaguehockey.ca/players' });
    assert.deepEqual(byLabel.get('News'), { kind: 'external', url: 'https://hockey-life.beerleaguehockey.ca/news' });
    assert.deepEqual(byLabel.get('Discover Leagues'), { kind: 'native', tab: 'Discover', screen: 'DiscoverMain' });
    assert.deepEqual(byLabel.get('Account'), { kind: 'native', tab: 'Profile', screen: 'ProfileMain' });
  });

  it('keeps the selected-tenant Teams directory external for guests and members', () => {
    for (const membership of [
      { userId: null, isMember: false },
      { userId: 'player-1', isMember: true },
    ]) {
      const teams = buildMoreMenu({ ...base, ...membership }).find((item) => item.key === 'league-teams');
      assert.deepEqual(teams?.destination, {
        kind: 'external',
        url: 'https://hockey-life.beerleaguehockey.ca/teams',
      });
    }
  });

  it('respects visible pages, playoff phase, registration, member and captain gates', () => {
    const labels = buildMoreMenu({
      ...base,
      visiblePages: { news: false, gallery: false },
      isPlayoffs: true,
      registrationOpen: true,
      userId: 'player-1',
      isMember: true,
      isCaptain: true,
    }).map((item) => item.label);

    assert.ok(labels.includes('Playoffs'));
    assert.ok(labels.includes('Register'));
    assert.ok(labels.includes('My Page'));
    assert.ok(labels.includes('Captain Dashboard'));
    assert.ok(labels.includes('Goalies'));
    assert.ok(!labels.includes('News'));
    assert.ok(!labels.includes('Gallery'));
    assert.deepEqual(
      buildMoreMenu({ ...base, registrationOpen: true }).find((item) => item.key === 'league-register')?.destination,
      { kind: 'external', url: 'https://hockey-life.beerleaguehockey.ca/goalies/register' },
    );
  });

  it('normalizes safe tenant custom links and rejects unsafe configured URLs', () => {
    const items = buildMoreMenu({
      ...base,
      customNavItems: [
        { label: 'Rules', isCustomPage: true, pageSlug: 'rules-and-policies' },
        { label: 'Shop', href: 'https://shop.example.test/hl', isExternal: true },
        { label: 'Bad JS', href: 'javascript:alert(1)', isExternal: true },
        { label: 'Bad Data', href: 'data:text/html,bad', isExternal: true },
        { label: 'Bad Relative', href: '//evil.example.test', isExternal: true },
      ],
    });

    assert.deepEqual(items.filter((item) => item.category === 'Custom').map((item) => [item.label, item.destination]), [
      ['Rules', { kind: 'external', url: 'https://hockey-life.beerleaguehockey.ca/p/rules-and-policies' }],
      ['Shop', { kind: 'external', url: 'https://shop.example.test/hl' }],
    ]);
  });

  it('defends direct menu construction from malformed JSON-shaped nav entries', () => {
    const malformed = [
      null,
      [],
      42,
      { label: 9, href: '/numeric-label' },
      { label: 'Numeric href', href: 9 },
      { label: 'Numeric slug', isCustomPage: true, pageSlug: 9 },
      { label: 'Numeric external flag', isExternal: 1, href: 'https://unsafe.example.test' },
      { label: 'Unsafe Scheme', isExternal: true, href: 'file:///tmp/nope' },
      { label: 'Valid Rules', isCustomPage: true, pageSlug: 'rules' },
    ] as any;

    assert.doesNotThrow(() => buildMoreMenu({ ...base, customNavItems: malformed }));
    assert.deepEqual(
      buildMoreMenu({ ...base, customNavItems: malformed })
        .filter((item) => item.category === 'Custom')
        .map((item) => item.label),
      ['Valid Rules'],
    );
  });

  it('offers only safe native app entry points when no league is selected', () => {
    const items = buildMoreMenu({ ...base, leagueSlug: '' });
    assert.deepEqual(items.map((item) => item.label), ['Home', 'Discover Leagues', 'Account']);
    assert.ok(items.every((item) => item.destination.kind === 'native'));
    assert.ok(items.every((item) => JSON.stringify(item.destination).includes('beerleaguehockey.ca') === false));
  });
});
