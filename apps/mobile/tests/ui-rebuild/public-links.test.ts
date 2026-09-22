import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HOCKEY_LIFE_SUPPORT_URL,
  PRIVACY_URL,
  TERMS_URL,
  openPublicLink,
} from '../../src/lib/publicLinks.ts';
import { buildMoreMenu } from '../../src/navigation/dockMenu.ts';

describe('public policy and support links', () => {
  it('uses the approved live HTTPS destinations', () => {
    assert.equal(PRIVACY_URL, 'https://beerleaguehockey.ca/privacy');
    assert.equal(TERMS_URL, 'https://beerleaguehockey.ca/terms');
    assert.equal(HOCKEY_LIFE_SUPPORT_URL, 'https://hockey-life.beerleaguehockey.ca/contact');
  });

  it('returns a clear failure when the operating system cannot open a link', async () => {
    const result = await openPublicLink(PRIVACY_URL, async () => {
      throw new Error('synthetic open failure');
    });

    assert.deepEqual(result, {
      success: false,
      error: 'This link could not be opened. Please try again.',
    });
  });

  it('rejects destinations outside the approved policy and support allowlist', async () => {
    let opened = false;
    const result = await openPublicLink('https://example.invalid/privacy', async () => {
      opened = true;
    });

    assert.equal(opened, false);
    assert.equal(result.success, false);
  });

  it('keeps privacy, terms, and support reachable in both guest and member menus', () => {
    for (const member of [false, true]) {
      const items = buildMoreMenu({
        leagueId: 'league-id',
        leagueSlug: 'hockey-life',
        isPlayoffs: false,
        registrationOpen: true,
        userId: member ? 'user-id' : null,
        isMember: member,
        isCaptain: false,
      });
      const links = new Map(items.map((item) => [item.label, item.destination]));

      assert.deepEqual(links.get('Privacy'), { kind: 'external', url: PRIVACY_URL });
      assert.deepEqual(links.get('Terms'), { kind: 'external', url: TERMS_URL });
      assert.deepEqual(links.get('Support'), { kind: 'external', url: HOCKEY_LIFE_SUPPORT_URL });
    }
  });
});
