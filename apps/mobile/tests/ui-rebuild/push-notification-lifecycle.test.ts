import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type ProfileUpdate = Record<string, unknown>;

function notificationFixture(options: {
  userId?: string | null;
  updateError?: { message: string } | null;
} = {}) {
  const updates: ProfileUpdate[] = [];
  const filters: Array<[string, unknown]> = [];
  let cancelled = 0;
  const chain = {
    update(payload: ProfileUpdate) {
      updates.push(payload);
      return chain;
    },
    async eq(column: string, value: unknown) {
      filters.push([column, value]);
      return { error: options.updateError ?? null };
    },
  };
  const notifications = {
    AndroidImportance: { MAX: 5 },
    setNotificationHandler: () => undefined,
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[current-device]' }),
    setNotificationChannelAsync: async () => undefined,
    scheduleNotificationAsync: async () => undefined,
    cancelAllScheduledNotificationsAsync: async () => { cancelled += 1; },
  };
  const secureStoreDeletes: string[] = [];
  const api = compileCommonJs<{
    registerForPushNotifications(): Promise<string | null>;
    unregisterPushNotifications(): Promise<{ error: Error | null }>;
  }>(new URL('../../src/lib/notifications.ts', import.meta.url), {
    'expo-device': { isDevice: true },
    'expo-notifications': notifications,
    'expo-secure-store': { deleteItemAsync: async (key: string) => { secureStoreDeletes.push(key); } },
    'react-native': { Platform: { OS: 'ios' } },
    './supabase/client': {
      supabase: {
        auth: { getUser: async () => ({ data: { user: options.userId === null ? null : { id: options.userId ?? 'player-1' } }, error: null }) },
        from: (table: string) => {
          assert.equal(table, 'profiles');
          return chain;
        },
      },
    },
  });

  return { api, filters, get cancelled() { return cancelled; }, secureStoreDeletes, updates };
}

describe('push-notification destination lifecycle', () => {
  it('persists the granted Expo token on the authenticated profile', async () => {
    const fixture = notificationFixture();

    assert.equal(await fixture.api.registerForPushNotifications(), 'ExponentPushToken[current-device]');
    assert.deepEqual(fixture.updates, [{ push_token: 'ExponentPushToken[current-device]' }]);
    assert.deepEqual(fixture.filters, [['id', 'player-1']]);
  });

  it('clears the authenticated profile token and local reminders before logout', async () => {
    const fixture = notificationFixture();

    assert.deepEqual(await fixture.api.unregisterPushNotifications(), { error: null });
    assert.deepEqual(fixture.updates, [{ push_token: null }]);
    assert.deepEqual(fixture.filters, [['id', 'player-1']]);
    assert.equal(fixture.cancelled, 1);
    assert.deepEqual(fixture.secureStoreDeletes, ['blh_notification_prefs']);
  });

  it('does not report successful revocation when the stored destination remains usable', async () => {
    const fixture = notificationFixture({ updateError: { message: 'profile update denied' } });

    const result = await fixture.api.unregisterPushNotifications();
    assert.equal(result.error?.message, 'profile update denied');
    assert.equal(fixture.cancelled, 1);
    assert.deepEqual(fixture.secureStoreDeletes, [], 'the persisted toggle must remain on when revocation fails');
  });

  it('still cancels local reminders when no authenticated profile remains', async () => {
    const fixture = notificationFixture({ userId: null });

    assert.deepEqual(await fixture.api.unregisterPushNotifications(), { error: null });
    assert.deepEqual(fixture.updates, []);
    assert.equal(fixture.cancelled, 1);
  });

  it('states the exact linked storage and revocation behavior in the privacy inventory', () => {
    const privacy = readFileSync(
      fileURLToPath(new URL('../../APP_STORE_PRIVACY.md', import.meta.url).toString()),
      'utf8',
    ).replace(/\s+/g, ' ');

    assert.match(privacy, /Expo push token.*profiles\.push_token/i);
    assert.match(privacy, /linked to the authenticated profile/i);
    assert.match(privacy, /disabl(?:e|ing).*logout.*account deletion/i);
    assert.match(privacy, /cancel.*local scheduled reminders/i);
    assert.doesNotMatch(privacy, /verify server-side token storage/i);
    assert.doesNotMatch(privacy, /whether push tokens are stored server-side/i);
  });
});
