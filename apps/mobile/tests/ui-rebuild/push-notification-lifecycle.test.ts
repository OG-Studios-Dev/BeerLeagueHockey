import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { compileCommonJs } from './component-harness.ts';

type ProfileUpdate = Record<string, unknown>;

function notificationFixture(options: {
  userId?: string | null;
  updateError?: { message: string } | null;
  platform?: 'android' | 'ios';
  channelError?: Error | null;
  channelGate?: Promise<void>;
  existingPermission?: string;
} = {}) {
  const updates: ProfileUpdate[] = [];
  const filters: Array<[string, unknown]> = [];
  let cancelled = 0;
  const events: string[] = [];
  const scheduledGameIds: string[] = [];
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
    getPermissionsAsync: async () => { events.push('permissions:get'); return { status: options.existingPermission ?? 'granted' }; },
    requestPermissionsAsync: async () => { events.push('permissions:request'); return { status: 'granted' }; },
    getExpoPushTokenAsync: async () => { events.push('token'); return { data: 'ExponentPushToken[current-device]' }; },
    setNotificationChannelAsync: async () => {
      events.push('channel');
      await options.channelGate;
      if (options.channelError) throw options.channelError;
    },
    scheduleNotificationAsync: async ({ content }: { content: { data: { gameId: string } } }) => {
      scheduledGameIds.push(content.data.gameId);
    },
    cancelAllScheduledNotificationsAsync: async () => { cancelled += 1; },
  };
  const secureStoreDeletes: string[] = [];
  const api = compileCommonJs<{
    registerForPushNotifications(): Promise<string | null>;
    scheduleGameRemindersForTeams(
      games: Array<{ id: string; scheduledAt: string; homeTeam: string; awayTeam: string; homeTeamId: string; awayTeamId: string }>,
      teamIds: string[],
    ): Promise<void>;
    unregisterPushNotifications(): Promise<{ error: Error | null }>;
  }>(new URL('../../src/lib/notifications.ts', import.meta.url), {
    'expo-device': { isDevice: true },
    'expo-notifications': notifications,
    'expo-secure-store': { deleteItemAsync: async (key: string) => { secureStoreDeletes.push(key); } },
    'react-native': { Platform: { OS: options.platform ?? 'ios' } },
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

  return { api, events, filters, get cancelled() { return cancelled; }, scheduledGameIds, secureStoreDeletes, updates };
}

describe('push-notification destination lifecycle', () => {
  it('persists the granted Expo token on the authenticated profile', async () => {
    const fixture = notificationFixture();

    assert.equal(await fixture.api.registerForPushNotifications(), 'ExponentPushToken[current-device]');
    assert.deepEqual(fixture.updates, [{ push_token: 'ExponentPushToken[current-device]' }]);
    assert.deepEqual(fixture.filters, [['id', 'player-1']]);
  });

  it('preserves the iOS permission and token flow without creating an Android channel', async () => {
    const fixture = notificationFixture({ platform: 'ios', existingPermission: 'undetermined' });

    assert.equal(await fixture.api.registerForPushNotifications(), 'ExponentPushToken[current-device]');
    assert.deepEqual(fixture.events, ['permissions:get', 'permissions:request', 'token']);
  });

  it('creates and awaits the Android channel before checking permission or obtaining a token', async () => {
    let releaseChannel!: () => void;
    const channelGate = new Promise<void>((resolve) => { releaseChannel = resolve; });
    const fixture = notificationFixture({
      platform: 'android',
      channelGate,
      existingPermission: 'undetermined',
    });

    const registration = fixture.api.registerForPushNotifications();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(fixture.events, ['channel']);

    releaseChannel();
    assert.equal(await registration, 'ExponentPushToken[current-device]');
    assert.deepEqual(fixture.events, ['channel', 'permissions:get', 'permissions:request', 'token']);
  });

  it('fails closed before permission and token work when Android channel setup fails', async () => {
    const fixture = notificationFixture({
      platform: 'android',
      channelError: new Error('channel unavailable'),
    });

    assert.equal(await fixture.api.registerForPushNotifications(), null);
    assert.deepEqual(fixture.events, ['channel']);
    assert.deepEqual(fixture.updates, []);
  });

  it('schedules reminders only for games involving explicit active team IDs', async () => {
    const fixture = notificationFixture();
    await fixture.api.scheduleGameRemindersForTeams([
      { id: 'mine-home', scheduledAt: '2099-10-01T20:00:00.000Z', homeTeam: 'Mine', awayTeam: 'One', homeTeamId: 'team-mine', awayTeamId: 'team-one' },
      { id: 'other-game', scheduledAt: '2099-10-02T20:00:00.000Z', homeTeam: 'Two', awayTeam: 'Three', homeTeamId: 'team-two', awayTeamId: 'team-three' },
      { id: 'mine-away', scheduledAt: '2099-10-03T20:00:00.000Z', homeTeam: 'Four', awayTeam: 'Mine', homeTeamId: 'team-four', awayTeamId: 'team-mine' },
    ], ['team-mine']);

    assert.deepEqual(fixture.scheduledGameIds, ['mine-home', 'mine-away']);
  });

  it('fails closed without scheduling when no active team IDs are provided', async () => {
    const fixture = notificationFixture();
    await fixture.api.scheduleGameRemindersForTeams([
      { id: 'league-game', scheduledAt: '2099-10-01T20:00:00.000Z', homeTeam: 'One', awayTeam: 'Two', homeTeamId: 'team-one', awayTeamId: 'team-two' },
    ], []);

    assert.deepEqual(fixture.scheduledGameIds, []);
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
    assert.match(
      privacy,
      /schedules local alerts only for games involving that player's active Hockey Life team assignments in the current active or playoff season/i,
    );
    assert.doesNotMatch(privacy, /verify server-side token storage/i);
    assert.doesNotMatch(privacy, /whether push tokens are stored server-side/i);
  });
});
