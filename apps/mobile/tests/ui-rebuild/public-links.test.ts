import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HOCKEY_LIFE_CAPTAIN_FEES_URL,
  HOCKEY_LIFE_CAPTAIN_URL,
  HOCKEY_LIFE_SUPPORT_URL,
  PRIVACY_URL,
  TERMS_URL,
  buildHockeyLifeCaptainLineupUrl,
  isApprovedPublicLink,
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

describe('captain web destinations', () => {
  it('builds only the exact Hockey Life captain lineup destination for a safe game ID', () => {
    assert.equal(
      buildHockeyLifeCaptainLineupUrl('game-1_safe'),
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/lineups/game-1_safe?mode=lineup',
    );

    for (const unsafeId of ['', ' ', '../scorekeeper', 'game/1', 'game?mode=score', 'game#fragment', 'game%2F1']) {
      assert.equal(buildHockeyLifeCaptainLineupUrl(unsafeId), null, unsafeId);
    }
  });

  it('allows only the exact captain landing, fees, and validated lineup URLs', () => {
    assert.equal(HOCKEY_LIFE_CAPTAIN_URL, 'https://hockey-life.beerleaguehockey.ca/hockey-life/captain');
    assert.equal(HOCKEY_LIFE_CAPTAIN_FEES_URL, 'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/fees');

    for (const approved of [
      HOCKEY_LIFE_CAPTAIN_URL,
      HOCKEY_LIFE_CAPTAIN_FEES_URL,
      buildHockeyLifeCaptainLineupUrl('game-1'),
    ]) {
      assert.equal(typeof approved, 'string');
      assert.equal(isApprovedPublicLink(approved!), true, approved!);
    }

    for (const rejected of [
      'http://hockey-life.beerleaguehockey.ca/hockey-life/captain',
      'https://beerleaguehockey.ca/hockey-life/captain',
      'https://other.beerleaguehockey.ca/hockey-life/captain',
      'https://hockey-life.beerleaguehockey.ca/other-league/captain',
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/scorekeeper',
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/lineups/game-1',
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/lineups/game-1?mode=score',
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/lineups/game%2F1?mode=lineup',
      'https://hockey-life.beerleaguehockey.ca/hockey-life/captain/fees?next=https://example.invalid',
    ]) {
      assert.equal(isApprovedPublicLink(rejected), false, rejected);
    }
  });

  it('catches synchronous opener throws for an approved captain destination', async () => {
    const result = await openPublicLink(HOCKEY_LIFE_CAPTAIN_FEES_URL, () => {
      throw new Error('synthetic synchronous failure');
    });

    assert.deepEqual(result, {
      success: false,
      error: 'This link could not be opened. Please try again.',
    });
  });
});
