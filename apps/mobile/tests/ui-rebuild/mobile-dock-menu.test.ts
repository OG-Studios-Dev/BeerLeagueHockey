import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMoreMenu } from '../../src/navigation/dockMenu.ts';

const base = {
  leagueId: '11111111-1111-4111-8111-111111111111',
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
    assert.deepEqual(byLabel.get('Teams'), { kind: 'native', tab: 'LeaguePages', screen: 'TeamsDirectory', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    assert.deepEqual(byLabel.get('Players'), { kind: 'native', tab: 'LeaguePages', screen: 'PlayersDirectory', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    assert.deepEqual(byLabel.get('News'), { kind: 'native', tab: 'LeaguePages', screen: 'NewsFeed', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    assert.deepEqual(byLabel.get('History'), { kind: 'native', tab: 'LeaguePages', screen: 'LeagueHistory', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    assert.deepEqual(byLabel.get('Gallery'), { kind: 'native', tab: 'LeaguePages', screen: 'GalleryAlbums', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    assert.deepEqual(byLabel.get('Events'), { kind: 'native', tab: 'LeaguePages', screen: 'Events', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    assert.deepEqual(byLabel.get('Contact'), { kind: 'native', tab: 'LeaguePages', screen: 'Contact', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    assert.equal(byLabel.has('Venues'), false);
    assert.equal(byLabel.has('About'), false);
    assert.equal(byLabel.has('Suspensions'), false);
    assert.equal(byLabel.has('Discover Leagues'), false);
    assert.deepEqual(byLabel.get('Account'), { kind: 'native', tab: 'Profile', screen: 'ProfileMain' });
  });

  it('keeps the selected-tenant Teams directory native for guests and members', () => {
    for (const membership of [
      { userId: null, isMember: false },
      { userId: 'player-1', isMember: true },
    ]) {
      const teams = buildMoreMenu({ ...base, ...membership }).find((item) => item.key === 'league-teams');
      assert.deepEqual(teams?.destination, { kind: 'native', tab: 'LeaguePages', screen: 'TeamsDirectory', params: { leagueId: base.leagueId, leagueSlug: base.leagueSlug } });
    }
  });

  it('respects visible pages, playoff phase, member and captain gates without generic registration', () => {
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
    assert.ok(!labels.includes('Register'));
    assert.ok(labels.includes('My Page'));
    assert.ok(labels.includes('Captain Dashboard'));
    assert.ok(labels.includes('Goalies'));
    assert.ok(!labels.includes('News'));
    assert.ok(!labels.includes('Gallery'));
    assert.equal(buildMoreMenu({ ...base, registrationOpen: true }).some((item) => item.key === 'league-register'), false);
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

  it('maps canonical Events and Contact aliases native, removes tenant Venues/About aliases, and preserves real custom content', () => {
    const items = buildMoreMenu({ ...base, customNavItems: [
      { label: 'Events alias', href: '/hockey-life/events' },
      { label: 'Contact alias', href: 'https://hockey-life.beerleaguehockey.ca/contact?from=menu', isExternal: true },
      { label: 'Venue alias', href: '/venues' },
      { label: 'About alias', href: 'https://hockey-life.beerleaguehockey.ca/hockey-life/about', isExternal: true },
      { label: 'About article', isCustomPage: true, pageSlug: 'about' },
      { label: 'Other site About', href: 'https://example.test/about', isExternal: true },
    ] });
    assert.equal(items.filter((item) => item.destination.kind === 'native' && item.destination.screen === 'Events').length, 1);
    assert.equal(items.filter((item) => item.destination.kind === 'native' && item.destination.screen === 'Contact').length, 1);
    assert.equal(items.some((item) => item.label === 'Venue alias' || item.label === 'About alias'), false);
    assert.ok(items.some((item) => item.label === 'About article' && item.destination.kind === 'external' && item.destination.url.endsWith('/p/about')));
    assert.ok(items.some((item) => item.label === 'Other site About'));
  });

  it('keeps hidden canonical Events and Contact aliases hidden for every role', () => {
    for (const role of [
      { userId: null, isMember: false, isCaptain: false },
      { userId: 'member', isMember: true, isCaptain: false },
      { userId: 'captain', isMember: true, isCaptain: true },
    ]) {
      const items = buildMoreMenu({
        ...base,
        ...role,
        visiblePages: { events: false, contact: false },
        customNavItems: [
          { label: 'Hidden Events', href: '/hockey-life/events' },
          { label: 'Hidden Contact', href: 'https://hockey-life.beerleaguehockey.ca/contact', isExternal: true },
        ],
      });
      assert.equal(items.some((item) => item.destination.kind === 'native' && ['Events', 'Contact'].includes(item.destination.screen ?? '')), false);
    }
  });

  it('normalizes only allowed HTTP(S) same-tenant aliases', () => {
    const items = buildMoreMenu({ ...base, customNavItems: [
      { label: 'HTTP events', href: 'http://hockey-life.beerleaguehockey.ca/events', isExternal: true },
      { label: 'HTTP about', href: 'http://hockey-life.beerleaguehockey.ca/about', isExternal: true },
      { label: 'HTTPS contact', href: 'https://hockey-life.beerleaguehockey.ca/hockey-life/contact', isExternal: true },
      { label: 'Other host', href: 'http://example.test/events', isExternal: true },
      { label: 'Credentials', href: 'https://user:pass@hockey-life.beerleaguehockey.ca/contact', isExternal: true },
      { label: 'Port', href: 'https://hockey-life.beerleaguehockey.ca:8443/events', isExternal: true },
      { label: 'FTP', href: 'ftp://hockey-life.beerleaguehockey.ca/events', isExternal: true },
      { label: 'Custom About', isCustomPage: true, pageSlug: 'about' },
    ] });
    assert.equal(items.filter((item) => item.destination.kind === 'native' && item.destination.screen === 'Events').length, 1);
    assert.equal(items.filter((item) => item.destination.kind === 'native' && item.destination.screen === 'Contact').length, 1);
    assert.equal(items.some((item) => item.label === 'HTTP about'), false);
    assert.ok(items.some((item) => item.label === 'Other host' && item.destination.kind === 'external'));
    assert.equal(items.some((item) => ['Credentials', 'Port', 'FTP'].includes(item.label) && item.destination.kind === 'native'), false);
    assert.equal(items.some((item) => ['Credentials', 'FTP'].includes(item.label)), false);
    assert.ok(items.some((item) => item.label === 'Port' && item.destination.kind === 'external'));
    assert.ok(items.some((item) => item.label === 'Custom About' && item.destination.kind === 'external' && item.destination.url.endsWith('/p/about')));
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
    assert.deepEqual(items.map((item) => item.label), ['Home', 'Support', 'Privacy', 'Terms', 'Account']);
    assert.ok(items.filter((item) => ['Home', 'Account'].includes(item.label)).every((item) => item.destination.kind === 'native'));
    assert.ok(items.filter((item) => ['Support', 'Privacy', 'Terms'].includes(item.label)).every((item) => item.destination.kind === 'external'));
  });
});
